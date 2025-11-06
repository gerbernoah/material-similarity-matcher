import type { Service } from ".";
import { ACCOUNT_KV_PREFIX, type AccountKV, authenticateToken } from "./auth";

type UserProfilePayload = {
	username?: string;
};

type UpdateUserPayload = {
	username?: string;
	password?: string;
	access?: boolean;
	admin?: boolean;
};

export const service: Service = {
	path: "/v1/users/",
	fetch: async (
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		subPath: string,
	): Promise<Response | undefined> => {
		const authContext = await authenticateToken(request.headers, env);

		if (authContext instanceof Response) {
			return authContext;
		}

		switch (`${request.method} /${subPath.split("/")[0]}`) {
			case "POST /update": {
				const updateData = await request.json<UpdateUserPayload>();
				const encodedTargetUser = updateData.username
					? encodeURIComponent(updateData.username)
					: authContext.username;

				if (!authContext.admin && encodedTargetUser !== authContext.username) {
					return new Response("Access denied", { status: 403 });
				}

				const userData: AccountKV | null = await env.DATA_KV.get(
					`${ACCOUNT_KV_PREFIX}/${encodedTargetUser}`,
					"json",
				);

				if (!userData) {
					return new Response("User not found", { status: 404 });
				}

				const updatedUser: AccountKV = {
					...userData,
					...updateData,
				};

				await env.DATA_KV.put(
					`${ACCOUNT_KV_PREFIX}/${encodedTargetUser}`,
					JSON.stringify(updatedUser),
				);

				return Response.json(
					{
						error: false,
						message: "User updated successfully",
					},
					{ status: 200 },
				);
			}
			case "GET /profile": {
				const profilePayload = await request.json<UserProfilePayload>();
				const encodedTargetUser = profilePayload.username
					? encodeURIComponent(profilePayload.username)
					: authContext.username;

				if (!authContext.admin && encodedTargetUser !== authContext.username) {
					return new Response("Access denied", { status: 403 });
				}

				const userData: AccountKV | null = await env.DATA_KV.get(
					`${ACCOUNT_KV_PREFIX}/${encodedTargetUser}`,
					"json",
				);

				if (!userData) {
					return new Response("User not found", { status: 404 });
				}

				return Response.json(
					{
						error: false,
						user: {
							username: userData.username,
							access: userData.access,
							admin: userData.admin,
						},
					},
					{ status: 200 },
				);
			}
		}
	},
};
