import type { Service } from ".";

export const service: Service = {
	path: "/v1/actuator/",
	fetch: async (
		request: Request,
		_env: Env,
		_ctx: ExecutionContext,
		subPath: string,
	): Promise<Response | undefined> => {
		switch (`${request.method} /${subPath.split("/")[0]}`) {
			case "GET /health": {
				return new Response(JSON.stringify({ status: "UP" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
		}

		return new Response("Not Found", { status: 404 });
	},
};
