import { StreamDb } from "./streamdb";
import { makeAsyncGeneratorAdapter } from "./makeAsyncGeneratorAdapter";

const asyncGenerator = makeAsyncGeneratorAdapter<number>(
	async asyncTerminator => {
		for (;;) {
			await asyncTerminator.next(1);
			await new Promise(resolve => setTimeout(resolve, 200));
		}
	},
);

const db = new StreamDb(
	asyncGenerator,
	0,
	async (state, _event, streams) => {
		const counter = state + 1;

		await streams.counter.next(counter);

		return counter;
	},
	{ counter: undefined },
	() => {},
);

(async () => {
	for await (const counter of db.subscribe("counter")) {
		console.log("From beginning", counter);
	}
})();

setTimeout(async () => {
	for await (const counter of db.subscribe("counter")) {
		console.log("Subscribed later", counter);
	}
}, 2000);
