import { makePersistentStreamDb } from "./streamdb";
import { makeAsyncGeneratorAdapter } from "./makeAsyncGeneratorAdapter";
import * as fs from "fs";

const asyncGenerator = makeAsyncGeneratorAdapter<number>(
	async asyncTerminator => {
		for (;;) {
			await asyncTerminator.next(Math.random());
			await new Promise(resolve => setTimeout(resolve, 200));
		}
	},
);

type State = {
	readonly count: number;
	readonly min: number;
	readonly max: number;
	readonly average: number;
};

const dirPath = "src/example3-files/";
const statePath = dirPath + "state.json";
const eventsPath = dirPath + "events.json";

(async () => {
	const db = await makePersistentStreamDb(
		{
			count: 0,
			min: 0,
			max: 0,
			average: 0,
		},
		asyncGenerator,
		function(state: State, event) {
			return state.count
				? {
						count: state.count + 1,
						min: Math.min(event, state.min),
						max: Math.max(event, state.max),
						average: (state.average * state.count + event) / (state.count + 1),
				  }
				: {
						count: 1,
						min: event,
						max: event,
						average: event,
				  };
		},
		async () => {
			// Read the latest saved state.
			let state: State | undefined;
			try {
				state = JSON.parse(fs.readFileSync(statePath, { encoding: "utf8" }));
			} catch (error) {}

			// Read any events not included in it.
			let events = (async function*(): AsyncIterableIterator<number> {
				try {
					for (const event of fs
						// Read the whole file.
						.readFileSync(eventsPath, { encoding: "utf8" })
						// Split by line.
						.split("\n")
						// Cut off the last, empty line.
						.slice(0, -1)
						// Parse each line.
						.map(line => JSON.parse(line))) {
						yield event;
					}
				} catch (error) {}
			})();

			return {
				state,
				events,
			};
		},
		async (state, event) => {
			// Write state periodically.
			if (!(state.count % 100)) {
				fs.writeFileSync(statePath, JSON.stringify(state, null, "\t"));

				// WARNING! This must be an atomic operation instead.
				// This implementation can fail on the last step, keeping both
				// the state and the events, so that the events will be applied
				// twice when loaded next time.

				// Clear the events, since they are included in the new state.
				fs.unlinkSync(eventsPath);
			}

			console.log("will write event");
			// Write event every time, appending it.
			fs.writeFileSync(eventsPath, JSON.stringify(event) + "\n", { flag: "a" });
			console.log("did write event");
		},
	);

	{
		const { events } = db.subscribe();
		for await (const { state } of events) {
			console.log(state);
		}
	}
})();
