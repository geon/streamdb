import {
	makeManualAsyncGeneratorAdapter,
	AsyncTerminator,
} from "./makeAsyncGeneratorAdapter";

export class PubSub<TEvent> {
	// tslint:disable-next-line: readonly-array
	private outputTerminators: Array<AsyncTerminator<TEvent>> = [];
	private done = false;

	constructor(inputStream: AsyncIterableIterator<TEvent>) {
		// Kick off a worker distributing events to the subscribers.
		(async () => {
			try {
				for await (const event of inputStream) {
					await Promise.all(
						this.outputTerminators.map(outputTerminator =>
							outputTerminator.next(event),
						),
					);
				}

				// When the stream from the reducer has ended, end the subscribers as well.
				for (const outputTerminator of this.outputTerminators) {
					outputTerminator.done();
				}

				this.done = true;
			} catch (error) {
				console.log("Throwing inside subscription");

				for (const outputTerminator of this.outputTerminators) {
					outputTerminator.throw(error);
				}
			}
		})();
	}

	subscribe(): AsyncIterableIterator<TEvent> {
		const { asyncTerminator, asyncGenerator } = makeManualAsyncGeneratorAdapter<
			TEvent
		>();

		if (this.done) {
			asyncTerminator.done();
		} else {
			this.outputTerminators.push(asyncTerminator);
		}

		return asyncGenerator;
	}
}
