import {
	makeManualAsyncGeneratorAdapter,
	AsyncTerminator,
} from "./makeAsyncGeneratorAdapter";

export class PubSub<TEvent> {
	// tslint:disable-next-line: readonly-array
	private subscribers: Array<{
		generator: AsyncIterableIterator<TEvent>;
		terminator: AsyncTerminator<TEvent>;
	}> = [];
	private done = false;

	constructor(inputStream: AsyncIterableIterator<TEvent>) {
		// Kick off a worker distributing events to the subscribers.
		(async () => {
			try {
				for await (const event of inputStream) {
					await Promise.all(
						this.subscribers.map(subscriber =>
							subscriber.terminator.next(event),
						),
					);
				}

				// When the stream from the reducer has ended, end the subscribers as well.
				for (const subscriber of this.subscribers) {
					subscriber.terminator.done();
				}

				this.done = true;
			} catch (error) {
				console.log("Throwing inside subscription");

				for (const subscriber of this.subscribers) {
					subscriber.terminator.throw(error);
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
			this.subscribers.push({
				generator: asyncGenerator,
				terminator: asyncTerminator,
			});
		}

		return asyncGenerator;
	}

	unsubscribe(generator: AsyncIterableIterator<TEvent>) {
		// Remove the subscriber.
		const index = this.subscribers.findIndex(
			subscriber => subscriber.generator === generator,
		);
		const [deleted] = this.subscribers.splice(index, 1);

		// Ensure that we are not waiting for a deleted subscriber to process an earlier message.
		deleted.generator.next();
	}
}
