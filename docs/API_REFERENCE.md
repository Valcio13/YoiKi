# 📡 YoiKi API & WebSocket Specification

All requests must be sent with `Content-Type: application/json` (except file uploads) and an `Authorization: Bearer <token>` header where required.

---

## 1. Authentication & Roles

When a session is created, four types of tokens are provisioned:
- **Host Token**: Full administrative privileges over rounds, characters, hints, and manual points.
- **Spectator Token**: Read-only access to non-sensitive game state, public drawings, and live previews.
- **Player Tokens (Slot 1 & Slot 2)**: Scoped strictly to the participant's assigned slot and hint inventory.

---

## 2. Session Management

### `POST /api/sessions`
Create a new game session.

- **Auth**: None (Public)
- **Request Body**:
  ```json
  {
    "mode": "2p",
    "playerNames": ["Alice", "Bob"],
    "startingPoints": 100
  }
  ```
- **Response** `(201 Created)`:
  ```json
  {
    "sessionId": "s_123456",
    "hostToken": "h_tok_xyz",
    "spectatorToken": "spec_tok_xyz",
    "mode": "2p",
    "participants": [
      { "id": "p_1", "slot": 1, "name": "Alice", "joinToken": "tok_1" },
      { "id": "p_2", "slot": 2, "name": "Bob", "joinToken": "tok_2" }
    ]
  }
  ```

### `GET /api/sessions/:id`
Fetch session status and participant standings.

- **Auth**: Host, Player, or Spectator
- **Response** `(200 OK)`:
  ```json
  {
    "session": {
      "id": "s_123456",
      "mode": "2p",
      "status": "playing",
      "current_round": 1
    },
    "participants": [
      { "id": "p_1", "slot": 1, "display_name": "Alice", "points": 85 }
    ]
  }
  ```

### `PATCH /api/sessions/:id/status`
Update session status (`lobby`, `playing`, `results`, `ended`).

- **Auth**: Host only
- **Request Body**: `{ "status": "results" }`

### `GET /api/sessions/:id/stats`
Fetch comprehensive post-game statistics, podium winners, and transaction audit log.

- **Auth**: Host, Player, or Spectator

---

## 3. Rounds & Gameplay

### `POST /api/rounds`
Host begins a new round. Increments `current_round` and sets session status to `playing`.

- **Auth**: Host only
- **Request Body**: `{ "sessionId": "s_123456" }`

### `POST /api/characters`
Host creates/assigns a character for a round.

- **Auth**: Host only
- **Request Body**:
  ```json
  {
    "sessionId": "s_123456",
    "roundId": "r_123",
    "heldBySlot": 2,
    "guessedBySlot": 1,
    "name": "Pikachu"
  }
  ```

### `GET /api/characters/:sessionId/:roundId`
Retrieve characters for the active round. Role-filtered:
- **Host**: Sees all characters unredacted.
- **Holder**: Sees the character name they hold.
- **Guesser**: Receives `name: "??? (Secret)"` until revealed.
- **Spectator**: Sees only revealed characters.

### `PATCH /api/characters/:id/reveal`
Host reveals a character answer to all participants and spectators.

---

## 4. Hint Shop & Point Ledger

### `POST /api/hints`
Host adds a hint to a character.

- **Auth**: Host only
- **Request Body**:
  ```json
  {
    "characterId": "c_123",
    "textContent": "Yellow electric mouse",
    "pointPrice": 15,
    "sortOrder": 1
  }
  ```

### `GET /api/hints/:characterId`
Fetch hints for a character.
- Unpurchased hints redact `text_content` to `null`.
- Players can only query hints for the character they are guessing.

### `POST /api/hints/:hintId/purchase`
Player unlocks a hint using points. Atomic transaction checks balance, updates ledger, and reveals clue.

- **Auth**: Player only

### `POST /api/points`
Host awards or deducts points manually.

- **Auth**: Host only
- **Request Body**:
  ```json
  {
    "participantId": "p_1",
    "delta": 25,
    "reason": "Accurate detailed drawing"
  }
  ```

---

## 5. Drawings & Storage (R2)

### `POST /api/drawings/submit`
Player submits completed PNG artwork at round conclusion.

- **Auth**: Player only
- **Content-Type**: `multipart/form-data`
- **Fields**: `roundId`, `drawing` (file blob)

### `GET /api/drawings/:roundId`
Lists submission status for the round.

### `GET /api/drawings/image/:drawingId`
Streams the full-resolution drawing image from Cloudflare R2.

---

## 6. WebSocket Hibernation Protocol

Connect via `GET /api/ws/:sessionId?token=<token>` with header `Upgrade: websocket`.

### Client $\rightarrow$ Server Messages

```jsonc
// 1. Live preview frame (Player only)
{
  "type": "preview",
  "data": "data:image/jpeg;base64,..."
}

// 2. Submission notification (Player only)
{
  "type": "drawing_submitted"
}

// 3. State update broadcast (Host only)
{
  "type": "state_update",
  "action": "round_started" | "character_created" | "hint_created" | "points_adjusted"
}
```

### Server $\rightarrow$ Client Messages

```jsonc
// 1. Live canvas preview forwarded to Host & Spectator
{
  "type": "preview",
  "participantId": "p_1",
  "slot": 1,
  "data": "data:image/jpeg;base64,...",
  "ts": 1793633000000
}

// 2. Player presence updates
{
  "type": "player_status",
  "participantId": "p_1",
  "slot": 1,
  "online": true | false
}

// 3. State update forwarded to all clients
{
  "type": "state_update",
  "action": "..."
}
```
