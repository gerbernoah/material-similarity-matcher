import type { Service } from ".";
import { ACCOUNT_KV_PREFIX, type AccountKV, authenticateToken } from "./auth";

type UpdateUserPayload = {
	password?: string;
	access?: boolean;
	admin?: boolean;
};

type UserProfile = {
	username: string;
	access: boolean;
	admin: boolean;
};

type UserListResponse = {
	users: UserProfile[];
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

		const parts = subPath.split("/");

		switch (`${request.method} /${parts[0]}`) {
			case "GET /list": {
				const author: AccountKV | null = await env.DATA_KV.get(
					`${ACCOUNT_KV_PREFIX}/${encodeURIComponent(authContext.username)}`,
					"json",
				);

				if (!author || !author.admin) {
					return new Response("Access denied", { status: 403 });
				}

				const userList = await env.DATA_KV.list({
					prefix: ACCOUNT_KV_PREFIX,
				});

				const userPromises: Promise<AccountKV>[] = [];
				for (const key of userList.keys) {
					userPromises.push(
						env.DATA_KV.get(key.name, { type: "json" }) as Promise<AccountKV>,
					);
				}

				const usersData = await Promise.all(userPromises);

				const responseData: UserListResponse = {
					users: usersData.map((user) => ({
						username: user.username,
						access: user.access,
						admin: user.admin,
					})),
				};

				return Response.json(responseData, { status: 200 });
			}
			case "POST /update": {
				const updateData = await request.json<UpdateUserPayload>();
				const encodedTargetUser = encodeURIComponent(
					parts[1] ?? authContext.username,
				);

				if (encodedTargetUser !== encodeURIComponent(authContext.username)) {
					const author: AccountKV | null = await env.DATA_KV.get(
						`${ACCOUNT_KV_PREFIX}/${encodeURIComponent(authContext.username)}`,
						"json",
					);

					if (!author || !author.admin) {
						return new Response("Access denied", { status: 403 });
					}
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
				const encodedTargetUser = encodeURIComponent(
					parts[1] ?? authContext.username,
				);

				if (encodedTargetUser !== encodeURIComponent(authContext.username)) {
					const author: AccountKV | null = await env.DATA_KV.get(
						`${ACCOUNT_KV_PREFIX}/${encodeURIComponent(authContext.username)}`,
						"json",
					);

					if (!author || !author.admin) {
						return new Response("Access denied", { status: 403 });
					}
				}

				const userData: AccountKV | null = await env.DATA_KV.get(
					`${ACCOUNT_KV_PREFIX}/${encodedTargetUser}`,
					"json",
				);

				if (!userData) {
					return new Response("User not found", { status: 404 });
				}

				const responseData: UserProfile = {
					username: userData.username,
					access: userData.access,
					admin: userData.admin,
				};

				return Response.json(responseData, { status: 200 });
			}
		}
	},
};
