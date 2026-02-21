# SharEat Hub - Instruction Manual

## 1. Introduction

Welcome to SharEat Hub, your all-in-one solution for managing restaurant operations. This manual provides a guide for all staff roles to effectively use the system, from initial setup to daily tasks.

---

## 2. Getting Started: Onboarding

Every new staff member must create an account to access the system.

1.  **Sign Up**: Navigate to the login page and click the "Sign up" link. Create an account using your email and a secure password.
2.  **Provide Details**: After creating your account, you will be prompted to enter your full name, address, and contact number.
3.  **Await Approval**: Once your details are submitted, your account status will be "Pending". A Platform Admin or Manager must approve your account and assign you a role and store(s) before you can log in.
4.  **First Login**: After your account is approved, you can log in with your credentials. You will be directed to the main dashboard for your role.

---

## 3. Role: Platform Administrator

Platform Admins have the highest level of access and are responsible for the global configuration of the system.

### Key Responsibilities:

-   **Staff Management**:
    -   Navigate to **Admin > Staff Management**.
    -   Approve pending user accounts, assign them a role (Manager, Cashier, etc.), and assign them to one or more stores.
    -   Deactivate or delete staff accounts as needed.
-   **Store Management**:
    -   Navigate to **Admin > Store Management**.
    -   Create new restaurant locations, edit their details (address, tax info, hours), and activate/deactivate them.
-   **Global Menu Management**:
    -   Navigate to **Admin > Menu Hub**.
    -   **Products**: Create and manage the master list of all products (e.g., "Chicken Wings", "Coke"). These are not sellable items themselves but templates for inventory.
    -   **Flavors**: Manage global flavors like "Spicy Buffalo" or "Garlic Parmesan".
    -   **Refills**: Define refillable items (e.g., "Iced Tea Refill").
    -   **Packages**: Create global package templates (e.g., "Unlimited Wings Package").

---

## 4. Role: Manager

Managers oversee the operations of their assigned store(s).

### Key Responsibilities:

-   **Store Settings**:
    -   Navigate to **Admin > Store Settings**.
    -   **Packages**: Set the price and availability for global packages within your store.
    -   **Refills & Flavors**: Enable or disable specific refills and flavors for your store.
    -   **Kitchen**: Define kitchen stations (e.g., "Fryer", "Grill") for your store.
    -   **Tables**: Configure the tables available in your restaurant.
-   **Collections**:
    -   Navigate to **Admin > Collections**.
    -   Manage store-specific **Modes of Payment**, **Charges** (e.g., Service Charge), and **Discounts** (e.g., Senior Citizen).
-   **Inventory Management**:
    -   Navigate to **Admin > Inventory Management**.
    -   Add products from the global catalog to your store's inventory.
    -   Set the `Cost` and `Selling Price` for each inventory item.
    -   Mark items as "Add-ons" to make them available for individual sale.
-   **Reporting & Logs**:
    -   **Dashboard**: View real-time sales analytics, top-selling items, and performance metrics.
    -   **Receipts & History**: Browse all past transactions, reprint receipts, and make corrections if needed.
    -   **Activity Logs**: View an audit trail of all significant actions taken by staff in your store.

---

## 5. Role: Cashier

Cashiers are responsible for managing customer sessions and processing payments.

### Key Responsibilities:

-   **Starting a Session**:
    -   From the **Cashier** page, select "Unlimited" or "Ala Carte".
    -   **For Unlimited**: Select an available table, choose the package, set the guest count, and select initial flavors.
    -   **For Ala Carte**: Enter the customer's name.
    -   Click "Start Session". For unlimited packages, the session becomes "Pending Verification" for a server. Ala carte orders are immediately active.
-   **Managing an Active Bill**:
    -   Click on an active session from the grid.
    -   **Add Add-ons**: Use the "Add Add-on" button to add items to the bill.
    -   **Apply Adjustments**: Apply bill-wide discounts or add charges (e.g., Service Charge).
    -   **Take Payment**: Record payments using the available payment methods. The balance and change are calculated automatically.
-   **Completing Payment**:
    -   Once the balance is zero (or more has been paid), click "Complete Payment".
    -   This closes the session and generates a receipt. You will be redirected to the receipt page for printing.

---

## 6. Role: Server

Servers are responsible for on-the-floor guest management and order-taking for refills and add-ons.

### Key Responsibilities:

-   **Verifying New Sessions**:
    -   On the **Server** page, find sessions in the "Pending Verification" list.
    -   Physically count the guests at the table.
    -   Enter the correct guest count in the "Server" field and click "Verify".
    -   If the count differs from the cashier's, a manager's approval may be needed.
-   **Managing Active Sessions**:
    -   **Order Refills**: Click the "Refill" button on an active session card. Select the refill items and flavors requested by the guests.
    -   **Order Add-ons**: Click the "Add-on" button to open the POS for add-on items. Add items to the guest's bill.
    -   All orders are sent directly to the designated kitchen station.
-   **Requesting Changes**:
    -   If a guest count or package changes mid-session, click "Request Change" on the session card and submit the request for cashier/manager approval.

---

## 7. Role: Kitchen Staff

Kitchen staff use the Kitchen Display System (KDS) to manage incoming orders.

### Key Responsibilities:

-   **Monitoring Orders**:
    -   On the **Kitchen** page, new orders appear as tickets in the appropriate station tab (e.g., "Fryer", "Drinks").
    -   Each ticket shows the item, quantity, notes/flavors, and how long it has been waiting.
-   **Managing Tickets**:
    -   When an item is ready, click the **"Served"** button on the ticket. This removes it from the active screen.
    -   If an item cannot be made (e.g., out of stock), click **"Cancel"** and select a reason. This notifies the cashier/server.
-   **Viewing History**:
    -   The "Order History" panel shows recently completed or cancelled items for quick reference.