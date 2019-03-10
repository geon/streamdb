import { PubSub } from "./pubsub";

export class StreamDb<TState, TEventIn, TEventOut> {
	private pubSub: PubSub<TEventOut>;
	private currentState: TState;

	constructor(
		initialState: TState,
		events: AsyncIterableIterator<TEventIn>,
		reduce: (
			state: TState,
			event: TEventIn,
		) => {
			readonly state: TState;
			readonly event?: TEventOut;
		},
		_persistenceStrategy: any,
	) {
		this.currentState = initialState;

		this.pubSub = new PubSub(
			(async function*(context: StreamDb<TState, TEventIn, TEventOut>) {
				for await (const event of events) {
					const { state: resultingState, event: resultingEvent } = reduce(
						context.currentState,
						event,
					);
					context.currentState = resultingState;
					if (resultingEvent) {
						yield resultingEvent;
					}
				}
			})(this),
		);
	}

	subscribe(): {
		readonly currentState: TState;
		readonly events: AsyncIterableIterator<TEventOut>;
	} {
		return { currentState: this.currentState, events: this.pubSub.subscribe() };
	}
}
