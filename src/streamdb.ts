import { makeManualAsyncGeneratorAdapter } from "./makeAsyncGeneratorAdapter";

type OutputStreamGenerator<TState, TEvent, TOutputEvent> = (
	inputStream: AsyncIterableIterator<{
		readonly state: TState;
		readonly event: TEvent;
		readonly oldState: TState;
	}>,
) => AsyncIterableIterator<TOutputEvent>;

export function reduce<TState, TEvent, TOutputStreamGenerators extends {}>(
	inputStream: AsyncIterableIterator<TEvent>,
	initialState: TState,
	reduce: (state: TState, event: TEvent) => TState,
	outputStreamGenerators: {
		[streamName in keyof TOutputStreamGenerators]: OutputStreamGenerator<
			TState,
			TEvent,
			TOutputStreamGenerators[streamName]
		>
	},
	_persistenceStrategy: any,
): {
	readonly streams: {
		[streamName in keyof TOutputStreamGenerators]: AsyncIterableIterator<
			TOutputStreamGenerators[streamName]
		>
	};
} {
	const streamsArray = ((Array.from(
		Object.entries(outputStreamGenerators),
	) as unknown) as ReadonlyArray<
		[
			keyof typeof outputStreamGenerators,
			OutputStreamGenerator<
				TState,
				TEvent,
				TOutputStreamGenerators[keyof typeof outputStreamGenerators]
			>
		]
	>).map(([streamName, streamGenerator]) => {
		const {
			asyncTerminator,
			asyncGenerator,
		} = makeManualAsyncGeneratorAdapter<{
			readonly state: TState;
			readonly event: TEvent;
			readonly oldState: TState;
		}>();

		const stream = streamGenerator(asyncGenerator);

		return {
			streamName,
			stream,
			asyncTerminator,
		};
	});

	(async () => {
		try {
			let state = initialState;
			for await (const event of inputStream) {
				const oldState = state;
				state = reduce(state, event);
				for (const stream of streamsArray) {
					await stream.asyncTerminator.next({ state, event, oldState });
				}
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

	const streams = streamsArray.reduce<
		{
			[streamName in keyof TOutputStreamGenerators]: AsyncIterableIterator<
				TOutputStreamGenerators[streamName]
			>
		}
	>(
		(soFar, current) => ({ ...soFar, [current.streamName]: current.stream }),
		{} as any,
	);

	return {
		streams,
	};
}
