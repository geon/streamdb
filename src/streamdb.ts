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
