# Royal Inn - Hotel Self-Service Kiosk (Backend)

[![Node.js](https://img.shields.io/badge/Node.js-v22.x-339933?logo=node.js&logoColor=white&style=for-the-badge)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-v5.x-000000?logo=express&logoColor=white&style=for-the-badge)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5.x-3178C6?logo=typescript&logoColor=white&style=for-the-badge)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white&style=for-the-badge)](https://supabase.com/)
![Status](https://img.shields.io/badge/Status-Completed-brightgreen?style=for-the-badge)

A robust RESTful backend powering the **Royal Inn Hotel Self-Service Kiosk**. Built using **Node.js**, **Express.js**, **TypeScript**, and **Supabase**, the backend manages hotel bookings, guest registration, payments, room availability, visitor management, room extensions, guest services, and hotel support requests through secure REST APIs.

---

## 🔗 Repositories

### Frontend Repository

https://github.com/PriyanshiG-HUB/hotel-kiosk-frontend

### Backend Repository

https://github.com/PriyanshiG-HUB/hotel-kiosk-backend

---

# 📖 Table of Contents

1. Features
2. Project Highlights
3. Backend Architecture
4. System Architecture
5. Technology Stack
6. Project Structure
7. REST API Endpoints
8. Database Schema
9. Installation
10. Environment Variables
11. Running the Server
12. API Testing
13. Future Enhancements
14. Contributing
15. License
16. Author

---

# 🌟 Features

- Guest Registration
- Walk-In Booking Creation
- Reservation Lookup
- Room Availability Management
- Automatic Room Status Updates
- Payment Processing
- Self Check-Out
- Visitor Registration
- Visitor Check-Out
- Visitor History
- Room Extension
- Guest Service Requests
- Need Help Requests
- Dashboard Statistics
- Supabase Database Integration
- RESTful API Design
- Modular Controller-Service Architecture

---

# 🚀 Project Highlights

- Express.js REST API
- TypeScript
- Supabase PostgreSQL
- Modular Architecture
- API-first Design
- Hotel Room Management
- Booking Management
- Visitor Management
- Payment Logging
- Dashboard Analytics
- Scalable Folder Structure

---

# 🏗 Backend Architecture

The backend follows a modular layered architecture.

- **Routes** define API endpoints.
- **Controllers** handle incoming HTTP requests.
- **Services** contain business logic.
- **Supabase** manages persistent data storage.
- **Express Middleware** provides validation, error handling, and request processing.

Business logic is separated from routing to improve maintainability and scalability.

---

# 🏛 System Architecture

```text
                React Native Frontend
                        │
                 REST API Requests
                        │
                        ▼
               Express.js Backend
                        │
        Controllers → Services → Database
                        │
                        ▼
             Supabase PostgreSQL Database
```

---

# 🛠 Technology Stack

| Technology | Purpose |
|------------|---------|
| Node.js | Runtime |
| Express.js | REST API Framework |
| TypeScript | Static Typing |
| Supabase | PostgreSQL Database |
| Axios | API Communication |
| dotenv | Environment Variables |
| UUID | Unique Identifier Generation |

---

# 📂 Project Structure

```text
hotel-kiosk-backend/
│
├── src/
│   ├── config/
│   ├── controllers/
│   ├── routes/
│   ├── services/
│   ├── middleware/
│   ├── utils/
│   ├── types/
│   ├── supabase/
│   ├── app.ts
│   └── server.ts
│
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── LICENSE
```

---

# 🔌 REST API Endpoints

## Booking APIs

| Method | Endpoint | Description |
|---------|----------|-------------|
| GET | `/rooms` | Fetch available rooms |
| GET | `/bookings/:id` | Booking details |
| GET | `/bookings/search/:mobile` | Search booking |
| POST | `/bookings` | Create booking |

---

## Guest APIs

| Method | Endpoint |
|---------|----------|
| POST | `/guests` |

---

## Payment APIs

| Method | Endpoint |
|---------|----------|
| POST | `/payments` |

---

## Visitor APIs

| Method | Endpoint |
|---------|----------|
| POST | `/visitors` |
| POST | `/visitors/checkout` |

---

## Room Extension

| Method | Endpoint |
|---------|----------|
| POST | `/room-extensions` |

---

## Service Request

| Method | Endpoint |
|---------|----------|
| POST | `/service-requests` |

---

## Need Help

| Method | Endpoint |
|---------|----------|
| POST | `/help/help-requests` |

---

## Dashboard

| Method | Endpoint |
|---------|----------|
| GET | `/dashboard` |

---

## Checkout

| Method | Endpoint |
|---------|----------|
| POST | `/checkout` |

---

# 🗄 Database Schema

The backend stores data in **Supabase PostgreSQL**.

Main tables include:

- guests
- rooms
- bookings
- payments
- visitors
- room_extensions
- service_requests
- help_requests

Relationships

```
Guests
   │
   ├── Bookings
   │      │
   │      ├── Payments
   │      └── Room Extensions
   │
   └── Visitors

Rooms
   │
   └── Bookings

Dashboard
   │
   └── Statistics
```

---

# ⚙ Installation

Clone the repository

```bash
git clone https://github.com/PriyanshiG-HUB/hotel-kiosk-backend.git

cd hotel-kiosk-backend
```

Install dependencies

```bash
npm install
```

---

# 🌐 Environment Variables

Create a `.env` file.

```env
PORT=5000

SUPABASE_URL=your_supabase_url

SUPABASE_ANON_KEY=your_supabase_key
```

---

# 🚀 Running the Server

Development

```bash
npm run dev
```

Production

```bash
npm run build

npm start
```

Server

```
http://localhost:5000
```

---

# 🧪 API Testing

The APIs can be tested using:

- Postman
- Thunder Client
- Insomnia
- cURL

Example

```http
POST /bookings
```

```json
{
  "guest_id":"...",
  "room_id":"...",
  "check_in":"2026-07-20",
  "check_out":"2026-07-22"
}
```

---

# 🚀 Future Enhancements

- JWT Authentication
- Role-Based Access Control
- Stripe Payment Gateway
- WebSocket Notifications
- Email Notifications
- SMS Notifications
- Native Hotel Hardware Integration
- Audit Logging
- Rate Limiting
- API Versioning

---

# 🤝 Contributing

Contributions, feature requests, and bug reports are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Push the branch.
5. Open a Pull Request.

---

# 📄 License

This project is licensed under the MIT License.

See the LICENSE file for details.

---

# 👨‍💻 Author

**Priyanshi Gajiwala**

B.Tech Information Technology

GitHub

https://github.com/PriyanshiG-HUB

LinkedIn

https://www.linkedin.com/in/priyanshi-gajiwala-1b00b7323/