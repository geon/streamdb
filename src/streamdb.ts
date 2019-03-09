import {
	makeManualAsyncGeneratorAdapter,
	AsyncTerminator,
} from "./makeAsyncGeneratorAdapter";

export class StreamDb<TState, TEvent, TOutputStreamGenerators extends {}> {
	private streams: {
		[streamName in keyof TOutputStreamGenerators]: AsyncIterableIterator<
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
		const streamsArray = ((Array.from(
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

		const terminators = streamsArray.reduce<
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

		(async () => {
			try {
				let state = initialState;
				for await (const event of inputStream) {
					state = await reduce(state, event, terminators);
				}

				for (const stream of streamsArray) {
					await stream.asyncTerminator.done();
				}
			} catch (error) {
				console.log("Throwing inside streamdb reducer");
				for (const stream of streamsArray) {
					await stream.asyncTerminator.throw(error);
				}
			}
		})();

		this.streams = streamsArray.reduce<
			{
				[streamName in keyof TOutputStreamGenerators]: AsyncIterableIterator<
					TOutputStreamGenerators[streamName]
				>
			}
		>(
			(soFar, current) => ({ ...soFar, [current.streamName]: current.stream }),
			{} as any,
		);
	}

	getStream<TStreamName extends keyof TOutputStreamGenerators>(
		streamName: TStreamName,
	): AsyncIterableIterator<TOutputStreamGenerators[TStreamName]> {
		return this.streams[streamName];
	}
}
