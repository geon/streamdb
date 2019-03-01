import * as StreamDb from "./streamdb";
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

		case "chat message": {
			return state;
		}

		default:
			exhaustiveCheck(event);
			return state;
	}
}

async function* nameChanges(
	stream: AsyncIterableIterator<{
		readonly state: State;
		readonly event: DbEvent;
		readonly oldState: State;
	}>,
) {
	for await (const { event, oldState } of stream) {
		if (event.type === "set user property" && event.propertyName === "name") {
			const oldUser = oldState.users[event.userId];
			yield {
				newName: event.value,
				oldName: oldUser && oldUser.name,
			};
		}
	}
}

async function* chatLines(
	stream: AsyncIterableIterator<{
		readonly event: DbEvent;
		readonly state: State;
	}>,
) {
	for await (const { event, state } of stream) {
		if (event.type === "chat message") {
			const user = state.users[event.userId];
			if (!user) {
				throw new Error("User does not exist: " + event.userId);
			}
			yield {
				message: event.message,
				name: user.name,
				aka: state.oldUserNames[event.userId],
			};
		}
	}
}

async function persistenceStrategy(
	_operation: "save" | "load",
	_state: State,
) {}

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

const db = StreamDb.reduce(
	asyncGenerator,
	initialState,
	reduce,
	{ nameChanges, chatLines },
	persistenceStrategy,
);

(async () => {
	for await (const nameChange of db.streams.nameChanges) {
		console.log(nameChange);
	}
})();

(async () => {
	for await (const chatLine of db.streams.chatLines) {
		console.log(chatLine);
	}
})();
