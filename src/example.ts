import { StreamDb } from "./streamdb";
import { makeAsyncGeneratorAdapter } from "./makeAsyncGeneratorAdapter";

function exhaustiveCheck(_: never) {}

interface State {
	readonly eventCounter: number;
	readonly users: { readonly [userId: string]: User | undefined };
	readonly oldUserNames: {
		readonly [userId: string]: ReadonlyArray<string> | undefined;
	};
}

interface User {
	readonly id: string;
	readonly name: string;
	readonly email: string;
	readonly birthDate: number;
}

type SettableUserPropertyName = Exclude<keyof User, "id">;
interface SetUserPropertyEvent<T extends SettableUserPropertyName> {
	readonly type: "set user property";
	readonly userId: string;
	readonly propertyName: T;
	readonly value: User[T];
}

// function makeSetUserPropertyEvent<
//   T extends SettableUserPropertyName,
//   U extends User[T]
// >(userId: string, propertyName: T, value: U): SetUserPropertyEvent<T> {
//   return {
//     type: "set user property",
//     userId,
//     propertyName,
//     value
//   };
// }

interface ChatMessageEvent {
	readonly type: "chat message";
	readonly userId: User["id"];
	readonly message: string;
}

type DbEvent =
	| SetUserPropertyEvent<"name">
	| SetUserPropertyEvent<"email">
	| SetUserPropertyEvent<"birthDate">
	| ChatMessageEvent;

interface NameChangeEvent {
	readonly type: "nameChange";
	readonly newName: string;
	readonly oldName?: string;
}

interface ChatLineEvent {
	readonly type: "chatLine";
	readonly message: string;
	readonly name: string;
	readonly aka: ReadonlyArray<string>;
}

function reduce(state: State, event: DbEvent): State {
	const eventCounter = state.eventCounter + 1;
	let oldUserNames = state.oldUserNames;

	switch (event.type) {
		case "set user property": {
			const defaultUser: User = {
				id: event.userId,
				name: "",
				email: "",
				birthDate: Date.now(),
			};

			const user = state.users[event.userId] || defaultUser;

			return {
				...state,
				eventCounter,
				users: {
					...state.users,
					[event.userId]: {
						...user,
						[event.propertyName]: event.value,
					},
				},
				oldUserNames:
					event.propertyName !== "name"
						? oldUserNames
						: {
								...state.oldUserNames,
								[event.userId]: [
									...(state.oldUserNames[event.userId] || []),
									user.name,
								],
						  },
			};
		}

		default:
			return state;
	}
}

const asyncGenerator = makeAsyncGeneratorAdapter<DbEvent>(
	async asyncTerminator => {
		await asyncTerminator.next({
			type: "set user property",
			userId: "abcdef",
			propertyName: "name",
			value: "geon",
		});
		await asyncTerminator.next({
			type: "chat message",
			userId: "abcdef",
			message: "hello",
		});
		await asyncTerminator.next({
			type: "set user property",
			userId: "abcdef",
			propertyName: "name",
			value: "neon",
		});
		await asyncTerminator.next({
			type: "chat message",
			userId: "abcdef",
			message: "world",
		});
	},
);

const initialState: State = {
	eventCounter: 0,
	users: {},
	oldUserNames: {},
};

const db = new StreamDb(initialState, asyncGenerator, reduce);

async function* derivedEvents(
	events: AsyncIterableIterator<{
		readonly state: State;
		readonly event: DbEvent;
		readonly oldState: State;
	}>,
): AsyncIterableIterator<NameChangeEvent | ChatLineEvent> {
	for await (const { event, state, oldState } of events) {
		switch (event.type) {
			case "set user property": {
				const oldUser = oldState.users[event.userId];

				if (event.propertyName === "name") {
					yield {
						type: "nameChange",
						newName: event.value,
						oldName: oldUser && oldUser.name,
					};
				}

				break;
			}

			case "chat message": {
				const user = state.users[event.userId];
				if (!user) {
					throw new Error("User does not exist: " + event.userId);
				}

				yield {
					type: "chatLine",
					message: event.message,
					name: user.name,
					aka: state.oldUserNames[event.userId] || [],
				};

				break;
			}

			default:
				exhaustiveCheck(event);
				throw new Error("Unknown event");
		}
	}
}

(async () => {
	for await (const event of derivedEvents(db.subscribe().events)) {
		console.log(event);
	}
})();
