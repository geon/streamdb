import {
	makeManualAsyncGeneratorAdapter,
	AsyncTerminator,
} from "./makeAsyncGeneratorAdapter";
import { PubSub } from "./pubsub";

export class StreamDb<TState, TEvent, TOutputStreamGenerators extends {}> {
	private pubSubs!: {
		// tslint:disable-next-line: readonly-array
		[streamName in keyof TOutputStreamGenerators]: PubSub<
			TOutputStreamGenerators[streamName]
		>
	};

	constructor(
		inputStream: AsyncIterableIterator<TEvent>,
		initialState: TState,
		reduce: (
			state: TState,
			event: TEvent,
			streams: {
				[streamName in keyof TOutputStreamGenerators]: AsyncTerminator<
					TOutputStreamGenerators[streamName]
				>
			},
		) => Promise<TState>,
		outputStreamGeneratorNamesInKeys: {
			[streamName in keyof TOutputStreamGenerators]: undefined
		},
		_persistenceStrategy: any,
	) {
		const reducerStreams = ((Array.from(
			Object.keys(outputStreamGeneratorNamesInKeys),
		) as unknown) as ReadonlyArray<
			keyof typeof outputStreamGeneratorNamesInKeys
		>).map(streamName => {
			const {
				asyncTerminator,
				asyncGenerator,
			} = makeManualAsyncGeneratorAdapter<
				TOutputStreamGenerators[typeof streamName]
			>();

			return {
				streamName,
				stream: asyncGenerator,
				asyncTerminator,
			};
		});

		const reducerTerminators = reducerStreams.reduce<
			{
				[streamName in keyof TOutputStreamGenerators]: AsyncTerminator<
					TOutputStreamGenerators[streamName]
				>
			}
		>(
			(soFar, current) => {
				soFar[current.streamName] = current.asyncTerminator;
				return soFar;
			},
			{} as any,
		);

		this.pubSubs = reducerStreams.reduce<
			{
				// tslint:disable-next-line: readonly-array
				[streamName in keyof TOutputStreamGenerators]: PubSub<
					TOutputStreamGenerators[streamName]
				>
			}
		>(
			(soFar, current) => ({
				...soFar,
				[current.streamName]: new PubSub(current.stream),
			}),
			{} as any,
		);

		(async () => {
			try {
				let state = initialState;
				for await (const event of inputStream) {
					state = await reduce(state, event, reducerTerminators);
				}

				for (const stream of reducerStreams) {
					await stream.asyncTerminator.done();
				}
			} catch (error) {
				console.log("Throwing inside streamdb reducer");
				for (const stream of reducerStreams) {
					await stream.asyncTerminator.throw(error);
				}
			}
		})();
	}

	subscribe<TStreamName extends keyof TOutputStreamGenerators>(
		streamName: TStreamName,
	): AsyncIterableIterator<TOutputStreamGenerators[TStreamName]> {
		return this.pubSubs[streamName].subscribe();
	}
}
