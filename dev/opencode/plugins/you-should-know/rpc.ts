// The contract between the server part, which decides what to show, and the GUI part, which shows it.
import { Rpc } from "@opencode/plugin/rpc"

export type Tag = "You should know" | "Heads up"
export type View = {
	/** "offer" is the one line; "explained" means they opened it and it stays until answered. */
	kind: "offer" | "explained"
	line: string
	tag: Tag
	title: string
	explanation: string
}
export type Action = "learn" | "knew" | "understood" | "dismiss"

const object = (properties: Record<string, object>) => ({
	type: "object" as const,
	properties,
	required: Object.keys(properties),
	additionalProperties: false,
})
const sessionID = { type: "string" }
const view = {
	anyOf: [
		{ type: "null" },
		object({
			kind: { enum: ["offer", "explained"] },
			line: { type: "string" },
			tag: { enum: ["You should know", "Heads up"] },
			title: { type: "string" },
			explanation: { type: "string" },
		}),
	],
}
const off = { type: "boolean" }

export const YouShouldKnow = Rpc.define({
	id: "you-should-know",
	methods: {
		/** Asking also tells the server a window has this session open. Only those get checked. */
		view: { input: object({ sessionID }), output: object({ view, off }) },
		act: { input: object({ sessionID, action: { enum: ["learn", "knew", "understood", "dismiss"] } }), output: object({ view }) },
		setOff: { input: object({ off }), output: object({}) },
	},
	events: {},
})
