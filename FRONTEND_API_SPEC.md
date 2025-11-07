# Material Similarity Matcher - Backend API Specification

## Overview
Backend service for material similarity matching with vector-based search, user authentication, and material management. Built on Cloudflare Workers with JWT authentication.

**Base URL**: Your deployed Cloudflare Worker URL
**CORS**: Enabled for all origins (update in production)

---

## Authentication

All endpoints except `/v1/actuator/health`, `/v1/auth/signup`, and `/v1/auth/signin` require authentication.

**Authentication Header**:
```
Authorization: Bearer <JWT_TOKEN>
```

### 1. Sign Up
- **Endpoint**: `POST /v1/auth/signup`
- **Description**: Register a new user (currently enabled, may be disabled)
- **Request Body**:
  ```json
  {
    "username": "string",
    "password": "string"
  }
  ```
- **Response**: `201 Created` - "User registered successfully"
- **Errors**: `400` - User already exists

### 2. Sign In
- **Endpoint**: `POST /v1/auth/signin`
- **Description**: Authenticate and receive JWT token
- **Request Body**:
  ```json
  {
    "username": "string",
    "password": "string"
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "token": "jwt_token_string"
  }
  ```
- **Errors**: `400` - User not found or invalid password

### 3. Verify Authentication
- **Endpoint**: `GET /v1/auth/`
- **Description**: Check if current token is valid
- **Headers**: Requires `Authorization: Bearer <token>`
- **Response**: `200 OK` - "Authenticated"
- **Errors**: `401` - Invalid token

---

## User Management

Requires authentication. Regular users can only manage their own profile; admins can manage any user.

### 1. Get User Profile
- **Endpoint**: `GET /v1/users/profile`
- **Description**: Get user profile information
- **Headers**: Requires `Authorization: Bearer <token>`
- **Request Body** (optional):
  ```json
  {
    "username": "string"  // Optional: admin can query other users
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "error": false,
    "user": {
      "username": "string",
      "access": boolean,  // Has access to materials API
      "admin": boolean    // Is administrator
    }
  }
  ```
- **Errors**: `403` - Access denied, `404` - User not found

### 2. Update User
- **Endpoint**: `POST /v1/users/update`
- **Description**: Update user profile (password, access, admin status)
- **Headers**: Requires `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "username": "string",  // Optional: admin can update other users
    "password": "string",  // Optional: new password
    "access": boolean,     // Optional: grant/revoke materials API access
    "admin": boolean       // Optional: grant/revoke admin privileges
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "error": false,
    "message": "User updated successfully"
  }
  ```
- **Errors**: `403` - Access denied, `404` - User not found

---

## Materials API

Requires authentication AND `access: true` permission.

### Material Object Structure
```typescript
{
  "id": "uuid",
  "name": "string",
  "description": "string",
  "price": number,        // Positive number
  "quality": number,      // 0 to 1 range
  "size": {
    "width": number,      // Optional, positive
    "height": number,     // Optional, positive
    "depth": number       // Optional, positive
  },
  "location": {
    "latitude": number,
    "longitude": number
  },
  "ebkp": {
    "type": "string",              // Optional
    "categoryCode": "string",      // Optional
    "subCategoryCode": "string"    // Optional
  }
}
```

### 1. Add Materials
- **Endpoint**: `POST /v1/materials/add`
- **Description**: Add new materials to the database and vector store
- **Headers**: Requires `Authorization: Bearer <token>` (user must have `access: true`)
- **Request Body**:
  ```json
  {
    "materials": [
      {
        "name": "string",
        "description": "string",
        "price": number,
        "quality": number,
        "size": {
          "width": number,
          "height": number,
          "depth": number
        },
        "location": {
          "latitude": number,
          "longitude": number
        },
        "ebkp": {
          "type": "string",
          "categoryCode": "string",
          "subCategoryCode": "string"
        }
      }
    ]
  }
  ```
  *Note: IDs are auto-generated; don't include them in the request*
- **Response**: `200 OK`
  ```json
  {
    "error": false,
    "message": "Materials Added"
  }
  ```
- **Errors**: `400` - Validation error, `403` - Access denied

### 2. Retrieve Similar Materials
- **Endpoint**: `POST /v1/materials/retrieve`
- **Description**: Find materials similar to the provided material using vector similarity search
- **Headers**: Requires `Authorization: Bearer <token>` (user must have `access: true`)
- **Request Body**:
  ```json
  {
    "material": {
      "name": "string",
      "description": "string",
      "price": number,
      "quality": number,
      "size": {
        "width": number,
        "height": number,
        "depth": number
      },
      "location": {
        "latitude": number,
        "longitude": number
      },
      "ebkp": {
        "type": "string",
        "categoryCode": "string",
        "subCategoryCode": "string"
      }
    },
    "topK": number  // 1-10, default: 5 (number of results to return)
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "error": false,
    "message": "Retrieval Successful",
    "data": [
      {
        "id": "uuid",
        "name": "string",
        "description": "string",
        "price": number,
        "quality": number,
        "size": {...},
        "location": {...},
        "ebkp": {...}
      }
    ]
  }
  ```
- **Errors**: `400` - Validation error, `403` - Access denied

---

## Health Check

### Health Status
- **Endpoint**: `GET /v1/actuator/health`
- **Description**: Check if the service is running
- **Authentication**: Not required
- **Response**: `200 OK`
  ```json
  {
    "status": "UP"
  }
  ```

---

## Error Responses

All endpoints may return:
- `401 Unauthorized` - Missing or invalid authentication token
- `403 Forbidden` - User doesn't have required permissions
- `404 Not Found` - Resource or endpoint not found
- `500 Internal Server Error` - Server error

Error responses generally follow this format:
```json
{
  "error": true,
  "message": "Error description"
}
```
Or simply a plain text error message.

---

## UI Flow Recommendations

### 1. Authentication Flow
1. **Login/Signup Page**: Username + password form
2. Store JWT token in localStorage/sessionStorage
3. Include token in all subsequent API calls
4. Handle 401 errors by redirecting to login

### 2. User Dashboard
- Display user profile (username, access status, admin status)
- Allow password change
- Show access status for materials API

### 3. Materials Management (requires access permission)
- **Add Materials Form**: 
  - Material name, description
  - Price (positive number)
  - Quality slider (0-1)
  - Size inputs (width, height, depth)
  - Location (latitude, longitude) - consider map picker
  - EBKP codes (optional)
  - Support batch adding multiple materials
  
- **Search Similar Materials**:
  - Form similar to "Add Materials" to describe target material
  - TopK slider (1-10) for number of results
  - Display results in cards/list with all material details
  - Visual similarity indicators

### 4. Admin Features (if admin: true)
- User management table
- Grant/revoke access to materials API
- Grant/revoke admin privileges
- View all users

---

## Notes for Frontend Development

1. **CORS**: Already configured on backend, all origins allowed
2. **Token Management**: Store JWT securely, include in Authorization header
3. **Permissions**: Check user `access` and `admin` flags to show/hide features
4. **Validation**: Backend uses Zod for validation - show user-friendly error messages
5. **Vector Search**: The similarity search is powered by ML embeddings - explain this to users
6. **EBKP Codes**: Swiss construction cost classification system - make optional/collapsible
7. **Location**: Coordinates affect similarity matching - consider map integration
8. **Quality**: Normalized 0-1 scale - use percentage display (0-100%)
