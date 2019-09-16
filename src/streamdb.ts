import { PubSub } from "./pubsub";

interface Change<TState, TEvent> {
	readonly state: TState;
	readonly event: TEvent;
	readonly oldState: TState;
}

export class StreamDb<TState, TEvent> {
	private pubSub: PubSub<Change<TState, TEvent>>;
	private currentState: TState;

	constructor(
		initialState: TState,
		events: AsyncIterableIterator<TEvent>,
		reduce: (state: TState, event: TEvent) => TState,
	) {
		this.currentState = initialState;

		this.pubSub = new PubSub(
			(async function*(context: StreamDb<TState, TEvent>) {
				for await (const event of events) {
					const oldState = context.currentState;
					context.currentState = reduce(context.currentState, event);
					yield {
						state: context.currentState,
						event,
						oldState,
					};
				}
			})(this),
		);
	}

	subscribe() {
		return { currentState: this.currentState, events: this.pubSub.subscribe() };
	}
}

export class PersistentStreamDb<TState, TEvent, TFrom> {
	initialState: TState;
	events: AsyncIterableIterator<TEvent>;
	reduce: (state: TState, event: TEvent) => TState;
	read: (
		from?: TFrom,
	) => Promise<{
		readonly state?: TState;
		readonly events: AsyncIterableIterator<TEvent>;
	}>;
	write: (state: TState, event: TEvent) => Promise<void>;
	defaultFrom: TFrom;

	db: Promise<StreamDb<TState, TEvent>>;

	constructor(
		initialState: TState,
		events: AsyncIterableIterator<TEvent>,
		reduce: (state: TState, event: TEvent) => TState,
		read: (
			from?: TFrom,
		) => Promise<{
			readonly state?: TState;
			readonly events: AsyncIterableIterator<TEvent>;
		}>,
		write: (state: TState, event: TEvent) => Promise<void>,
		defaultFrom: TFrom,
	) {
		this.initialState = initialState;
		this.events = events;
		this.reduce = reduce;
		this.read = read;
		this.write = write;
		this.defaultFrom = defaultFrom;

		this.db = (async () => {
			const loaded = await read();

			let state = loaded.state || initialState;
			for await (const event of loaded.events) {
				state = reduce(state, event);
			}

			const db = new StreamDb(state, events, reduce);
			const subscription = db.subscribe();

			(async () => {
				for await (const event of subscription.events) {
					try {
						await write(event.state, event.event);
					} catch (error) {
						subscription.events.throw!(error);
					}
				}
			})();

			return db;
		})();
	}

	async subscribeWithHistory(from: TFrom) {
		const subscription = (await this.db).subscribe();

		return  {
			currentState: fromState,
			events: AsyncIterableIterator<Change<TState, TEvent>>;
		}
	}
}
