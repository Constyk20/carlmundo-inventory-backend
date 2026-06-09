# Inventory Management API — Documentation

## Base URL
```
http://localhost:5000/api
```

## Authentication
All protected routes require:
```
Authorization: Bearer <accessToken>
```

---

## Auth `/api/auth`

| Method | Endpoint              | Auth | Body / Notes                                      |
|--------|-----------------------|------|---------------------------------------------------|
| POST   | `/login`              | ✗    | `{ email, password }` → `{ user, accessToken, refreshToken }` |
| POST   | `/refresh-token`      | ✗    | `{ userId, refreshToken }` → new token pair       |
| POST   | `/logout`             | ✓    | Invalidates refresh token                         |
| POST   | `/register`           | Admin| `{ name, email, password, role, permissions? }`   |
| PUT    | `/change-password`    | ✓    | `{ currentPassword, newPassword }`                |
| GET    | `/me`                 | ✓    | Returns current user profile                      |

**Roles:** `admin` | `manager` | `production_manager` | `accountant` | `staff` | `viewer`

**Security features:**
- Account locked for 30 min after 5 failed login attempts
- Access token expires in 15 min (configurable)
- Refresh token rotation on every refresh
- Password change invalidates all refresh tokens

---

## Users `/api/users`  *(Admin only)*

| Method | Endpoint                       | Notes                                     |
|--------|--------------------------------|-------------------------------------------|
| GET    | `/`                            | `?page&limit&sort&search&role&isActive`   |
| GET    | `/:id`                         |                                           |
| PUT    | `/:id`                         | `{ name, email, role, permissions, restrictedFeatures }` |
| PUT    | `/:id/deactivate`              | Kills active sessions immediately         |
| PUT    | `/:id/activate`                | Re-enables account                        |
| PUT    | `/:id/reset-password`          | `{ newPassword }`                         |
| PUT    | `/:id/feature-restrictions`    | `{ restrictedFeatures: ["reports", ...] }`|
| DELETE | `/:id`                         | Soft delete                               |
| GET    | `/audit-logs`                  | `?userId&entity&action&startDate&endDate` |

---

## Products `/api/products`

| Method | Endpoint                   | Permission          | Notes                              |
|--------|----------------------------|---------------------|------------------------------------|
| GET    | `/`                        | `inventory:read`    | `?search&category&lowStock=true`   |
| GET    | `/:id`                     | `inventory:read`    |                                    |
| GET    | `/:id/movements`           | `inventory:read`    | Stock movement history             |
| POST   | `/`                        | `inventory:write`   | Creates product + initial movement |
| PUT    | `/:id`                     | `inventory:write`   | Logs price history automatically   |
| POST   | `/:id/adjust-stock`        | `inventory:write`   | `{ type, quantity, reference, notes }` |
| DELETE | `/:id`                     | `inventory:delete`  | Soft delete                        |

**Stock adjustment types:** `purchase` | `adjustment` | `return` | `damage` | `transfer` | `production_use`

**Product categories:** `cake_box` | `pastry_box` | `gift_box` | `carrier_bag` | `wrapper` | `label` | `other`

---

## Customers `/api/customers`

| Method | Endpoint               | Permission           | Notes                        |
|--------|------------------------|----------------------|------------------------------|
| GET    | `/`                    | `customers:read`     | `?search&type&isActive`      |
| GET    | `/:id`                 | `customers:read`     | Includes purchase summary    |
| GET    | `/:id/transactions`    | `customers:read`     | Paginated transaction history|
| POST   | `/`                    | `customers:write`    | Auto-generates customerCode  |
| PUT    | `/:id`                 | `customers:write`    |                              |
| DELETE | `/:id`                 | `customers:delete`   | Hard delete if no history    |

---

## Expenses `/api/expenses`

| Method | Endpoint           | Permission           | Notes                              |
|--------|--------------------|----------------------|------------------------------------|
| GET    | `/`                | `expenses:read`      | Non-managers see only their own    |
| GET    | `/:id`             | `expenses:read`      |                                    |
| POST   | `/`                | `expenses:write`     | Auto-approved for managers+        |
| PUT    | `/:id`             | `expenses:write`     | Only pending expenses editable     |
| PUT    | `/:id/approve`     | `expenses:approve`   | `{ action: "approve"/"reject", rejectionReason? }` |
| DELETE | `/:id`             | `expenses:delete`    | Approved = admin only              |

**Expense categories:** `raw_materials` | `utilities` | `rent` | `salaries` | `transport` | `maintenance` | `marketing` | `office_supplies` | `packaging` | `other`

---

## Transactions `/api/transactions`

| Method | Endpoint            | Permission              | Notes                                      |
|--------|---------------------|-------------------------|--------------------------------------------|
| GET    | `/`                 | `transactions:read`     | `?status&paymentStatus&customer&startDate&endDate` |
| GET    | `/:id`              | `transactions:read`     |                                            |
| POST   | `/`                 | `transactions:write`    | Validates stock, deducts automatically     |
| PUT    | `/:id/cancel`       | `transactions:delete`   | `{ reason }` — restores stock             |

**Payment methods:** `cash` | `transfer` | `cheque` | `credit` | `pos`

---

## Prices `/api/prices`

| Method | Endpoint              | Permission       | Notes                                          |
|--------|-----------------------|------------------|------------------------------------------------|
| GET    | `/lookup`             | `prices:read`    | `?productId&customerId&quantity` — best price  |
| GET    | `/`                   | `prices:read`    | All price lists                                |
| GET    | `/:id`                | `prices:read`    |                                                |
| POST   | `/`                   | `prices:write`   | `{ name, type, entries[], assignedCustomers[] }` |
| PUT    | `/:id`                | `prices:write`   |                                                |
| PUT    | `/:id/customers`      | `prices:write`   | `{ customerIds[] }` — assign customers        |
| DELETE | `/:id`                | `prices:write`   |                                                |

---

## Reports `/api/reports`

| Method | Endpoint          | Permission      | Notes                                |
|--------|-------------------|-----------------|--------------------------------------|
| GET    | `/dashboard`      | `reports:read`  | `?period=today/week/month/quarter/year` |
| GET    | `/sales`          | `reports:read`  | `?startDate&endDate&groupBy=day/month` |
| GET    | `/expenses`       | `reports:read`  | `?startDate&endDate`                 |
| GET    | `/inventory`      | `reports:read`  | Stock valuation by category          |
| GET    | `/profit-loss`    | `reports:read`  | P&L summary                          |

---

## Excel `/api/excel`

| Method | Endpoint                   | Permission       | Notes                             |
|--------|----------------------------|------------------|-----------------------------------|
| GET    | `/template?type=products`  | `excel:export`   | Also `type=customers`             |
| GET    | `/export/products`         | `excel:export`   |                                   |
| GET    | `/export/transactions`     | `excel:export`   | `?startDate&endDate`              |
| GET    | `/export/expenses`         | `excel:export`   | `?startDate&endDate`              |
| GET    | `/export/customers`        | `excel:export`   |                                   |
| POST   | `/import/products`         | `excel:import`   | multipart/form-data, field: `file`|
| POST   | `/import/customers`        | `excel:import`   | multipart/form-data, field: `file`|

---

## Notifications `/api/notifications`

| Method | Endpoint             | Auth   | Notes                              |
|--------|----------------------|--------|------------------------------------|
| GET    | `/`                  | ✓      | `?unreadOnly=true` — user-scoped   |
| POST   | `/`                  | Admin  | `{ title, message, type, recipients?, recipientRoles? }` |
| PUT    | `/mark-all-read`     | ✓      |                                    |
| PUT    | `/:id/read`          | ✓      |                                    |
| DELETE | `/:id`               | Admin  |                                    |

---

## Permissions Reference

| Permission          | Description                           |
|---------------------|---------------------------------------|
| `inventory:read`    | View products and stock               |
| `inventory:write`   | Create/edit products, adjust stock    |
| `inventory:delete`  | Delete products                       |
| `customers:read`    | View customers                        |
| `customers:write`   | Create/edit customers                 |
| `customers:delete`  | Delete customers                      |
| `expenses:read`     | View expenses                         |
| `expenses:write`    | Create/edit expenses                  |
| `expenses:delete`   | Delete expenses                       |
| `expenses:approve`  | Approve or reject expenses            |
| `transactions:read` | View sales transactions               |
| `transactions:write`| Create transactions                   |
| `transactions:delete`| Cancel transactions                  |
| `reports:read`      | View all reports                      |
| `reports:export`    | Export reports                        |
| `prices:read`       | View price lists                      |
| `prices:write`      | Create/edit price lists               |
| `users:read`        | View users (non-sensitive)            |
| `users:write`       | Create/edit users                     |
| `excel:import`      | Import from Excel                     |
| `excel:export`      | Export to Excel                       |
| `audit:read`        | View audit logs                       |

---

## Default Role Permissions

| Role                 | Default permissions                                              |
|----------------------|------------------------------------------------------------------|
| `admin`              | **ALL** permissions                                              |
| `manager`            | All except `audit:read`, `users:write`                          |
| `production_manager` | `inventory:read/write`, `expenses:read`, `transactions:read`, `reports:read`, `prices:read`, `excel:export` |
| `accountant`         | `expenses:*`, `transactions:read`, `reports:*`, `prices:*`, `excel:*` |
| `staff`              | `inventory:read`, `customers:read`, `transactions:read`, `prices:read` |
| `viewer`             | `inventory:read`, `reports:read`                                 |

---

## Error Response Format

```json
{
  "success": false,
  "message": "Human-readable error message",
  "errors": ["field-level errors if validation failed"]
}
```

## Success Response Format

```json
{
  "success": true,
  "data": { ... },
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "pages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## Rate Limits

| Endpoint       | Limit                     |
|----------------|---------------------------|
| All `/api/*`   | 200 req / 15 min          |
| `/api/auth/login` | 5 req / 15 min (per IP) |

## Environment Variables

```env
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb://localhost:27017/inventory_db
JWT_SECRET=<min 32 chars, random>
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=<min 32 chars, random>
JWT_REFRESH_EXPIRES_IN=7d
ADMIN_NAME=Super Admin
ADMIN_EMAIL=admin@company.com
ADMIN_PASSWORD=Admin@123456
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=200
LOGIN_RATE_LIMIT_MAX=5
FRONTEND_URL=http://localhost:3000
LOW_STOCK_THRESHOLD=10
```
