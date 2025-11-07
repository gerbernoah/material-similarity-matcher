export { service as actuators } from "./actuator";
export { service as auth } from "./auth";
export { service as materials } from "./materials";
export { service as users } from "./users";

export type Service = {
	path: string;
	fetch: (
		request: Request,
		env: Env,
		ctx: ExecutionContext,
		subPath: string,
	) => Promise<Response | undefined>;
};
