## **API Endpoints**

### Authentication

| Method | Endpoint             | Description       |
| ------ | -------------------- | ----------------- |
| POST   | `/api/auth/register` | Register new user |
| POST   | `/api/auth/login`    | Login user        |

### Events

| Method | Endpoint      | Description               |
| ------ | ------------- | ------------------------- |
| POST   | `/api/events` | Create event (Organizer+) |

### Tickets

| Method | Endpoint                    | Description              |
| ------ | --------------------------- | ------------------------ |
| POST   | `/api/tickets/purchase`     | Buy ticket               |
| POST   | `/api/tickets/transfer/:id` | Transfer ticket          |
| POST   | `/api/tickets/validate`     | Validate ticket (Staff+) |

## Rate Limits

| Endpoint Group   | Limit        | Window |
| ---------------- | ------------ | ------ |
| All routes       | 100 requests | 15 min |
| Auth endpoints   | 20 requests  | 15 min |
| Ticket purchases | 10 requests  | 1 hour |
