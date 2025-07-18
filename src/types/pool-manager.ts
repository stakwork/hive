// Pool Manager-specific types and interfaces

//Example Payload
// {
//   "username": "test",
//   "email": "test@test.com",
//   "password": "testasdasd"
// }
export interface CreateUserRequest {
    email: string;
    password: string;
    username: string;
}
//Response:
// {
//   "message": "User 'test' created successfully",
//   "success": true,
//   "user": {
//       "authentication_token": "Ian3duxe8RL-v10fnxTsLLXizMJgVtYRPAta_SLP5_s",
//       "created_at": "2025-07-18T16:20:21.833950",
//       "email": "test@test.com",
//       "is_active": true,
//       "last_login": null,
//       "pool_count": 0,
//       "pools": [],
//       "username": "test"
//   }
// }
// Use authentication_token in the call to CreatePool under Authorization: Bearer ${authentication_token}

//Example payload
// {
//   "pool_name": "my-pool-name",
//   "minimum_vms": 1,
//   "repo_name": "https://github.com/gonzaloaune/ganamos",
//   "branch_name": "main",
//   "github_pat": "ghp_asjidjasdjkasdkjsakjdkja",
//   "github_username": "gonzaloaune",
//   "env_vars": [
//       {
//           "name": "my-env",
//           "value": "my-env-value",
//           "masked": false
//       }
//   ]
// }
export interface CreatePoolRequest {
    pool_name: string;
    minimum_vms: number;
    repo_name: string;
    branch_name: string;
    github_pat: string;
    github_username: string;
    env_vars: []; //Key value pair of name and value
}
//Response:
// {
//   "message": "Pool 'my-pool-name' created successfully",
//   "owner": "admin",
//   "pool": {
//       "branch_name": "main",
//       "created_at": "2025-07-18T15:33:53.711824",
//       "env_vars": [
//           {
//               "masked": true,
//               "name": "my-env",
//               "value": "my********ue"
//           }
//       ],
//       "github_pat": {
//           "masked": true,
//           "value": "gh************************ja"
//       },
//       "github_username": "gonzaloaune",
//       "minimum_vms": 1,
//       "owner_username": null,
//       "pool_name": "my-pool-name",
//       "repo_name": "https://github.com/gonzaloaune/ganamos"
//   },
//   "success": true
// }

export interface GetPoolRequest {
    name: string;
}

export interface DeletePoolRequest {
    name: string;
}

export interface UpdatePoolRequest {
    name: string;
    description?: string;
    members?: string[];
}

export interface PoolUser {
    email: string;
    username: string;
    authentication_token: string;
}

export interface Pool {
    id: string;
    name: string;
    description?: string;
    owner_id: string;
    created_at: string;
    updated_at: string;
    status: "active" | "archived" | "deleted";
}

export interface AuthBody {
    username: string;
    password: string;
}

export interface PoolManagerAuthResponse {
    success: boolean;
    token: string;
}
