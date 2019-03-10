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
	0,
	asyncGenerator,
	function(state, _event) {
		let counter = state + 1;
		return { state: counter, event: counter };
	},
	() => {},
);

(async () => {
	const { currentState, events } = db.subscribe();
	console.log("Subscribing when current state is:", currentState);
	for await (const counter of events) {
		console.log("From beginning", counter);
	}
})();

setTimeout(async () => {
	const { currentState, events } = db.subscribe();
	console.log("Subscribing when current state is:", currentState);
	for await (const counter of events) {
		console.log("Subscribed later", counter);
	}
}, 2000);
