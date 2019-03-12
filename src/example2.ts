import { StreamDb } from "./streamdb";
import { makeAsyncGeneratorAdapter } from "./makeAsyncGeneratorAdapter";

const asyncGenerator = makeAsyncGeneratorAdapter<number>(
	async asyncTerminator => {
		for (let i = 0; i < 15; ++i) {
			await asyncTerminator.next(1);
			await new Promise(resolve => setTimeout(resolve, 200));
		}
	},
);

const db = new StreamDb(0, asyncGenerator, function(state, _event) {
	let counter = state + 1;
	return counter;
});

(async () => {
	const { currentState, events } = db.subscribe();
	console.log("Subscribing when current state is:", currentState);
	for await (const { state } of events) {
		console.log("From beginning", state);
	}
})();

setTimeout(async () => {
	const { currentState, events } = db.subscribe();
	console.log("Subscribing when current state is:", currentState);
	for await (const { state } of events) {
		console.log("Subscribed later", state);
	}
}, 2000);
