interface PromiseAndCallbacks<T> {
	readonly promise: Promise<T>;
	readonly resolve: (data: T) => void;
	readonly reject: (error: Error) => void;
}

function makePromiseAndCallbacks<T>(): PromiseAndCallbacks<T> {
	let resolve!: (data: T) => void;
	let reject!: (error: Error) => void;

	const promise: Promise<T> = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return {
		promise,
		resolve,
		reject,
	};
}

interface AsyncTerminator<T> {
	readonly next: (data: T) => Promise<void>;
	readonly throw: (error: Error) => void;
	readonly done: () => void;
}

export function makeManualAsyncGeneratorAdapter<T>(): {
	readonly asyncTerminator: AsyncTerminator<T>;
	readonly asyncGenerator: AsyncIterableIterator<T>;
} {
	let queue: Array<{
		readonly data: T;
		readonly handled: PromiseAndCallbacks<void>;
	}> = [];

	let done = false;
	let error: Error | undefined;

	const asyncTerminator: AsyncTerminator<T> = {
		next: (data: T) => {
			const handled = makePromiseAndCallbacks<void>();
			queue.push({
				data,
				handled,
			});
			return handled.promise;
		},
		throw: (err: Error) => {
			error = err;
		},
		done: () => {
			done = true;
		},
	};

	const asyncGenerator = (async function*() {
		for (;;) {
			// Wait for the terminator to send data.
			// I previously used promises for that, but they created a
			// memory leak. So busy-loop it is.
			for (;;) {
				if (queue.length) {
					break;
				}
				if (error) {
					throw error;
				}
				if (done) {
					return;
				}
				await new Promise(resolve => setTimeout(resolve, 0));
			}

			try {
				// Yield out all queued up data.
				for (const queued of queue) {
					yield queued.data;
					queued.handled.resolve(undefined);
				}
				queue = [];
			} catch (error) {
				// Reject ALL THE THINGS!
				// Promises resolved before the throw will have their reject called too, but that's a no-op.
				for (const queued of queue) {
					queued.handled.reject(error);
				}
				return;
			}
		}
	})();

	return {
		asyncTerminator,
		asyncGenerator,
	};
}

export function makeAsyncGeneratorAdapter<T>(
	job: (iterator: AsyncTerminator<T>) => Promise<void>,
): AsyncIterableIterator<T> {
	const { asyncTerminator, asyncGenerator } = makeManualAsyncGeneratorAdapter<
		T
	>();

	job(asyncTerminator).then(asyncTerminator.done);

	return asyncGenerator;
}
