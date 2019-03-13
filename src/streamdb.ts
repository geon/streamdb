import { PubSub } from "./pubsub";

export class StreamDb<TState, TEvent> {
	private pubSub: PubSub<{
		readonly state: TState;
		readonly event: TEvent;
		readonly oldState: TState;
	}>;
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

export async function makePersistentStreamDb<TState, TEvent>(
	initialState: TState,
	events: AsyncIterableIterator<TEvent>,
	reduce: (state: TState, event: TEvent) => TState,
	read: () => Promise<{
		readonly state?: TState;
		readonly events: ReadonlyArray<TEvent>;
	}>,
	write: (state: TState, event: TEvent) => Promise<void>,
): Promise<StreamDb<TState, TEvent>> {
	const loaded = await read();

	let state = loaded.state || initialState;
	for (const event of loaded.events) {
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
}
