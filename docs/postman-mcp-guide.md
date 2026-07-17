# Connecting to the Plant Library MCP Server with Postman

This document explains how to connect to the Plant Library MCP server from Postman.

It is written for the server implementation that currently exists in this repository:

- The MCP server runs with FastMCP over HTTP.
- The endpoint path is `/mcp/`.
- Authentication uses a Personal Access Token (PAT) in a bearer header.
- The PAT is resolved to a user, and all tool responses are scoped to that user's property memberships.
- PAT plaintext is never stored server-side. Only the hash is stored. After creation, the plain token is shown once.

This guide assumes you want to use Postman as a manual MCP client for testing and exploration.

## What you are actually connecting to

This repository's MCP server is not a REST API. It is an MCP server exposed over FastMCP's HTTP transport.

That means:

- You do not call `GET /mcp/tools` or `GET /mcp/list_properties`.
- You send JSON-RPC 2.0 requests to a single MCP endpoint.
- The important MCP methods for Postman are:
  - `initialize`
  - `notifications/initialized`
  - `tools/list`
  - `tools/call`

In this repo, the local Docker port mapping is:

- Frontend: `http://localhost:3000`
- Backend REST API: `http://localhost:8000`
- MCP server: `http://localhost:8100/mcp/`

If you are not using Docker and are running the MCP server directly, the endpoint is typically:

- `http://localhost:8000/mcp/`

## Important authentication note

The current MCP server code authenticates with PATs, not with the old `MCP_API_KEYS` environment variable pattern.

If you notice `MCP_API_KEYS` in older deployment or Docker examples, treat that as legacy configuration. The current code path uses the PAT verifier in `mcp/server.py` and checks the token against the hashed PAT records stored in Cosmos DB.

So for Postman, you should use:

- `Authorization: Bearer <your_pat>`

Not:

- a global static API key
- an Entra access token

## What Postman is good at here

Postman is useful for:

- manually initializing an MCP session
- listing tools
- calling tools
- testing auth failures
- verifying property-scoped access

Postman is less ideal for:

- long-lived interactive MCP client behavior
- streaming-heavy workflows
- building a production MCP integration

For this server, Postman is still perfectly fine for most operational testing because the tool surface is simple and request/response oriented.

## Prerequisites

Before you start, make sure you have all of the following:

1. A running Plant Library MCP server.
2. A user account that already has access to one or more properties.
3. A PAT created for that user.
4. Postman installed.

## Step 1: Start the server

### Option A: Docker compose

From the repo root:

```bash
docker compose up --build
```

Then the MCP endpoint should be:

```text
http://localhost:8100/mcp/
```

### Option B: Run the MCP server directly

From the repo root, make sure the backend app environment variables are available because the MCP server reuses the backend data layer.

Example:

```bash
cd mcp
python server.py
```

If you run it directly with the current code, it starts on:

```text
http://0.0.0.0:8000/mcp/
```

So locally you would use:

```text
http://localhost:8000/mcp/
```

## Step 2: Create a PAT

You need a Personal Access Token for MCP.

You can create one in either of these ways:

### Option A: Use the frontend UI

If the frontend is running, open the account menu and go to the Personal Access Tokens page. Create a token and copy it immediately.

Remember:

- the plaintext token is shown once
- later listings only return token identifiers
- the server stores only the hash

### Option B: Use the REST API

Call the backend API with your normal signed-in bearer token:

```http
POST http://localhost:8000/api/auth/pats
Authorization: Bearer <entra_access_token_or_existing_user_bearer>
Content-Type: application/json

{}
```

Example successful response:

```json
{
  "id": "pat_1234567890abcdef",
  "name": null,
  "last_four": "abcd",
  "expires_at": "2027-07-16T21:40:00.000000Z",
  "last_used_at": null,
  "created_at": "2026-07-16T21:40:00.000000Z",
  "token": "plpat_pat_1234567890abcdef.very_long_secret_here"
}
```

Copy the `token` value. That is what Postman will send in the `Authorization` header.

## Step 3: Create a Postman collection

Create a new collection named something like:

```text
Plant Library MCP
```

Add these collection variables:

| Variable | Example | Purpose |
| --- | --- | --- |
| `mcpBaseUrl` | `http://localhost:8100/mcp/` | MCP endpoint |
| `pat` | `plpat_pat_...` | Personal access token |
| `mcpSessionId` | empty initially | Session id returned after `initialize` |
| `propertyId` | empty initially | A property id you discover from `list_properties` |
| `gardenId` | empty initially | Optional, if you want garden-scoped calls |
| `plantId` | empty initially | Optional, for plant-specific calls |
| `classId` | empty initially | Optional, for species-specific calls |

## Step 4: Configure common headers

For MCP requests in Postman, use these headers:

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer {{pat}}` |
| `Content-Type` | `application/json` |
| `Accept` | `application/json, text/event-stream` |

After initialization, also include:

| Header | Value |
| --- | --- |
| `mcp-session-id` | `{{mcpSessionId}}` |

Notes:

- `Authorization` is required for every request.
- `mcp-session-id` is usually not available until after the `initialize` call.
- Using `Accept: application/json, text/event-stream` is a good default for MCP over streamable HTTP.

## Step 5: Initialize the MCP session

Create a Postman request named:

```text
Initialize MCP Session
```

### Request

Method:

```text
POST
```

URL:

```text
{{mcpBaseUrl}}
```

Headers:

```http
Authorization: Bearer {{pat}}
Content-Type: application/json
Accept: application/json, text/event-stream
```

Body:

```json
{
  "jsonrpc": "2.0",
  "id": "init-1",
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": {
      "name": "Postman",
      "version": "1.0"
    }
  }
}
```

### What to expect

You should get:

- an HTTP success response
- a JSON-RPC `result`
- an `mcp-session-id` response header

You must keep that session id and send it on the following MCP requests.

### Postman test script to capture the session id

Put this in the request's `Tests` tab:

```javascript
const sessionId = pm.response.headers.get("mcp-session-id");
if (sessionId) {
  pm.collectionVariables.set("mcpSessionId", sessionId);
}
```

Optional assertion:

```javascript
pm.test("MCP session id captured", function () {
  pm.expect(pm.collectionVariables.get("mcpSessionId")).to.be.ok;
});
```

### If `2025-03-26` does not work

If your installed MCP stack negotiates a different protocol version, try:

```json
"protocolVersion": "2024-11-05"
```

Use whichever version the server accepts.

## Step 6: Send the initialized notification

After `initialize`, MCP clients normally send `notifications/initialized`.

Create a request named:

```text
Initialized Notification
```

Method:

```text
POST
```

URL:

```text
{{mcpBaseUrl}}
```

Headers:

```http
Authorization: Bearer {{pat}}
Content-Type: application/json
Accept: application/json, text/event-stream
mcp-session-id: {{mcpSessionId}}
```

Body:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized",
  "params": {}
}
```

This is a notification, so it does not need an `id`.

## Step 7: List available tools

Create a request named:

```text
List Tools
```

Method:

```text
POST
```

URL:

```text
{{mcpBaseUrl}}
```

Headers:

```http
Authorization: Bearer {{pat}}
Content-Type: application/json
Accept: application/json, text/event-stream
mcp-session-id: {{mcpSessionId}}
```

Body:

```json
{
  "jsonrpc": "2.0",
  "id": "tools-1",
  "method": "tools/list",
  "params": {}
}
```

### Expected tools in this repo

You should see some or all of these tools:

- `list_properties`
- `list_gardens`
- `list_plant_species`
- `get_plant_species`
- `create_plant_species`
- `update_plant_species`
- `delete_plant_species`
- `list_plants`
- `get_plant`
- `create_plant`
- `update_plant`
- `delete_plant`
- `log_care_event`
- `resolve_scan`
- `care_dashboard`

These are defined by `mcp/server.py`.

## Step 8: Call a tool

All actual business operations happen through `tools/call`.

The request shape is:

```json
{
  "jsonrpc": "2.0",
  "id": "call-1",
  "method": "tools/call",
  "params": {
    "name": "tool_name_here",
    "arguments": {
      "arg1": "value1"
    }
  }
}
```

## First recommended call: `list_properties`

This is the safest first real tool call because it proves both authentication and user scoping.

Create a request named:

```text
Call list_properties
```

Body:

```json
{
  "jsonrpc": "2.0",
  "id": "call-list-properties-1",
  "method": "tools/call",
  "params": {
    "name": "list_properties",
    "arguments": {}
  }
}
```

### What this proves

If this succeeds, then:

- your PAT is valid
- the MCP server accepted the session
- the PAT resolved to a user
- the user has at least one visible property

If it returns an empty property list, auth may still be correct, but the user may not belong to any properties.

## Example: `list_gardens`

Once you have a property id, store it in the `propertyId` collection variable.

Body:

```json
{
  "jsonrpc": "2.0",
  "id": "call-list-gardens-1",
  "method": "tools/call",
  "params": {
    "name": "list_gardens",
    "arguments": {
      "property_id": "{{propertyId}}"
    }
  }
}
```

## Example: `list_plant_species`

Body:

```json
{
  "jsonrpc": "2.0",
  "id": "call-list-species-1",
  "method": "tools/call",
  "params": {
    "name": "list_plant_species",
    "arguments": {
      "property_id": "{{propertyId}}"
    }
  }
}
```

## Example: `list_plants`

Body:

```json
{
  "jsonrpc": "2.0",
  "id": "call-list-plants-1",
  "method": "tools/call",
  "params": {
    "name": "list_plants",
    "arguments": {
      "property_id": "{{propertyId}}"
    }
  }
}
```

Optional garden filter:

```json
{
  "jsonrpc": "2.0",
  "id": "call-list-plants-by-garden-1",
  "method": "tools/call",
  "params": {
    "name": "list_plants",
    "arguments": {
      "property_id": "{{propertyId}}",
      "garden_id": "{{gardenId}}"
    }
  }
}
```

## Example: `care_dashboard`

Body:

```json
{
  "jsonrpc": "2.0",
  "id": "call-dashboard-1",
  "method": "tools/call",
  "params": {
    "name": "care_dashboard",
    "arguments": {
      "property_id": "{{propertyId}}"
    }
  }
}
```

## Example: `resolve_scan`

Body:

```json
{
  "jsonrpc": "2.0",
  "id": "call-scan-1",
  "method": "tools/call",
  "params": {
    "name": "resolve_scan",
    "arguments": {
      "plant_id": "plant_ab12cd34ef"
    }
  }
}
```

## Example: `create_plant_species`

Body:

```json
{
  "jsonrpc": "2.0",
  "id": "call-create-species-1",
  "method": "tools/call",
  "params": {
    "name": "create_plant_species",
    "arguments": {
      "property_id": "{{propertyId}}",
      "species": {
        "common_name": "Monstera Deliciosa",
        "scientific_name": "Monstera deliciosa",
        "reference_urls": [],
        "tags": [],
        "care_defaults": {
          "watering_interval_days": 7,
          "sunlight": "bright_indirect"
        }
      }
    }
  }
}
```

## Example: `create_plant`

You need a valid `class_id` and `garden_id` first.

Body:

```json
{
  "jsonrpc": "2.0",
  "id": "call-create-plant-1",
  "method": "tools/call",
  "params": {
    "name": "create_plant",
    "arguments": {
      "property_id": "{{propertyId}}",
      "plant": {
        "class_id": "{{classId}}",
        "garden_id": "{{gardenId}}",
        "nickname": "Big Monstera",
        "health_status": "healthy",
        "care_overrides": {},
        "image_urls": [],
        "tag_ids": []
      }
    }
  }
}
```

## Example: `log_care_event`

Body:

```json
{
  "jsonrpc": "2.0",
  "id": "call-water-plant-1",
  "method": "tools/call",
  "params": {
    "name": "log_care_event",
    "arguments": {
      "property_id": "{{propertyId}}",
      "instance_id": "{{plantId}}",
      "event": {
        "type": "watered",
        "notes": "Watered from Postman"
      }
    }
  }
}
```

## Understanding MCP responses in Postman

Do not expect the same response shape as the REST API.

MCP wraps results in a JSON-RPC envelope. You will typically see:

```json
{
  "jsonrpc": "2.0",
  "id": "call-list-properties-1",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "..."
      }
    ]
  }
}
```

Depending on the MCP implementation version and tool result encoding, you may also see structured content.

When inspecting a response in Postman:

- first check `result`
- then check `result.structuredContent` if present
- then check `result.content`
- if there is an MCP error, check `error`

## Recommended Postman request set

For repeatable manual testing, create these requests in order:

1. `Initialize MCP Session`
2. `Initialized Notification`
3. `List Tools`
4. `Call list_properties`
5. `Call list_gardens`
6. `Call list_plant_species`
7. `Call list_plants`
8. `Call care_dashboard`
9. `Call resolve_scan`

That is enough for most smoke tests.

## Useful Postman scripts

### Capture the first property id

Because MCP payloads can vary, this is best-effort and may need adjustment depending on the returned structure.

```javascript
const json = pm.response.json();
const result = json.result || {};

if (result.structuredContent && Array.isArray(result.structuredContent)) {
  if (result.structuredContent[0]?.id) {
    pm.collectionVariables.set("propertyId", result.structuredContent[0].id);
  }
}
```

If the server returns the property list as text content instead, just copy the property id manually into the collection variable.

### Fail fast on MCP errors

```javascript
const json = pm.response.json();
pm.test("No MCP error", function () {
  pm.expect(json.error).to.eql(undefined);
});
```

## Troubleshooting

### 401 Unauthorized

Likely causes:

- missing `Authorization` header
- malformed bearer token
- expired PAT
- PAT copied incorrectly

What to check:

- header is exactly `Authorization: Bearer {{pat}}`
- token starts with `plpat_`
- token was copied when first created
- token has not been revoked

### 403-style tool failure or permission error

Likely causes:

- the PAT belongs to a user who is not a member of the property
- the tool argument uses a property id the user cannot access

What to do:

- call `list_properties` first
- use only property ids returned there

### `Property not found`

The property id may be wrong, or may belong to another tenant.

### `Referenced species ... does not exist`

For `create_plant`, your `class_id` is wrong or belongs to another property.

### `Referenced garden ... does not exist`

For `create_plant`, your `garden_id` is wrong or belongs to another property.

### No `mcp-session-id` header returned

Possible causes:

- the `initialize` request failed
- auth failed before the session was created
- the request was not sent to the MCP endpoint path

Check:

- URL really ends in `/mcp/`
- the PAT is valid
- the body is a valid JSON-RPC `initialize` request

### `tools/list` or `tools/call` fails after initialize

Usually this means one of these:

- you forgot the `mcp-session-id` header
- you did not send `notifications/initialized`
- you changed sessions mid-flow

### Postman follows redirects or rewrites headers

If you are hitting a reverse proxy in front of the MCP service, confirm it preserves:

- `Authorization`
- `mcp-session-id`
- `Content-Type`

## Security guidance

Treat the PAT like a password.

Do not:

- paste it into shared workspaces
- commit it into a Postman collection file
- send it over insecure channels
- leave it in screenshots

Preferred practice:

- store it in a Postman environment variable
- mark the variable as sensitive if your Postman tier supports it
- revoke it when you are done with testing

## What to use for local testing versus deployed environments

### Local Docker

Use:

```text
http://localhost:8100/mcp/
```

### Local direct server process

Use:

```text
http://localhost:8000/mcp/
```

### Azure or another deployed host

Use your deployed public origin, for example:

```text
https://your-host.example.com/mcp/
```

The exact hostname depends on your deployment.

## Minimal working request sequence

If you just want the shortest sequence that proves Postman connectivity:

1. Create a PAT.
2. `POST {{mcpBaseUrl}}` with `initialize`.
3. Capture `mcp-session-id`.
4. `POST {{mcpBaseUrl}}` with `notifications/initialized` and `mcp-session-id`.
5. `POST {{mcpBaseUrl}}` with `tools/call` for `list_properties` and `mcp-session-id`.

That is the smallest end-to-end happy path.

## Suggested collection layout

```text
Plant Library MCP
  Setup
    Initialize MCP Session
    Initialized Notification
    List Tools
  Discovery
    Call list_properties
    Call list_gardens
    Call list_plant_species
    Call list_plants
  Operations
    Call create_plant_species
    Call create_plant
    Call log_care_event
    Call care_dashboard
    Call resolve_scan
```

## Final notes

The most common mistake is treating the MCP server like REST.

Remember the model:

- one HTTP endpoint
- JSON-RPC requests
- initialize first
- persist the `mcp-session-id`
- call tools through `tools/call`
- authenticate every request with a PAT bearer token

If you follow that sequence, Postman works fine as a manual client for this server.