import {
	makeManualAsyncGeneratorAdapter,
	AsyncTerminator,
} from "./makeAsyncGeneratorAdapter";

export class StreamDb<TState, TEvent, TOutputStreamGenerators extends {}> {
	private outputTerminators!: {
		// tslint:disable-next-line: readonly-array
		[streamName in keyof TOutputStreamGenerators]: Array<
			AsyncTerminator<TOutputStreamGenerators[streamName]>
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

		this.outputTerminators = reducerStreams.reduce<
			{
				// tslint:disable-next-line: readonly-array
				[streamName in keyof TOutputStreamGenerators]: Array<
					AsyncTerminator<TOutputStreamGenerators[streamName]>
				>
			}
		>((soFar, current) => ({ ...soFar, [current.streamName]: [] }), {} as any);

		// For each stream name...
		for (const reducerStream of reducerStreams) {
			// ...kick off a worker...
			(async () => {
				try {
					// ...taking the events produced by the reducer...
					for await (const event of reducerStream.stream) {
						// ...and distributing it among the subscribers.
						await Promise.all(
							this.outputTerminators[reducerStream.streamName].map(
								outputTerminator => outputTerminator.next(event),
							),
						);
					}

					// When the stream from the reducer has ended, end the subscribers as well.
					for (const outputTerminator of this.outputTerminators[
						reducerStream.streamName
					]) {
						outputTerminator.done();
					}
				} catch (error) {
					console.log("Throwing inside subscription");

					for (const outputTerminator of this.outputTerminators[
						reducerStream.streamName
					]) {
						outputTerminator.throw(error);
					}
				}
			})();
		}

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
		const { asyncTerminator, asyncGenerator } = makeManualAsyncGeneratorAdapter<
			TOutputStreamGenerators[TStreamName]
		>();

		this.outputTerminators[streamName].push(asyncTerminator);

		return asyncGenerator;
	}
}
