# **App Name**: CulinaryFlow

## Core Features:

- Secure Authentication: Firebase Authentication with role-based access control (admin, manager, cashier, kitchen, server). 6-digit code protection for login/signup, managed by the admin.
- Store Management: Admins manage stores (create, edit, activate/deactivate). Managers manage assigned stores.
- Product & Inventory: Admins manage global products; stores manage inventory (add from global products, adjust quantities, reorder points).
- Menu Management: Stores create/manage menus from inventory, with pricing and component management.
- POS Cashier Interface: Point-of-sale for cashiers: create orders, manage quantities, process payments, and print a placeholder receipt.
- Kitchen Display System (KDS): Display real-time order tickets in the kitchen, filter by status, and bump tickets. Kitchen stations are based on global collections.
- Refill/Server Queue: List of tickets needing refills; staff can mark as served.
- Admin Settings & Role Management: Settings page for admins to configure app-wide settings, including the login code and role-based access control.  New signups become pending accounts waiting for admin verification. Role-Based Access Control implemented logic for admins, cashiers, kitchen staff, servers, managers (manager hub).
- Resilience tools: Implement shift/open-close accounting and cash drawer reconciliation

## Style Guidelines:

- Primary color: Deep red (#8B0000) for a bold, modern feel.
- Background: Desaturated red (#F5E2E2) for a light, complementary background.
- Accent color: Orange-yellow (#FFB300) for contrast and highlights.
- Main font for headings: 'Baloo' (sans-serif) for headings and prominent text elements as per the user request. Note: currently only Google Fonts are supported.
- Secondary font for body text: 'Poppins' (sans-serif) for body text and supporting information as per the user request. Note: currently only Google Fonts are supported.
- lucide-react icons for a clean and consistent look throughout the application as per the user request.
- Navbar includes the logo, store switcher, and buttons for 'Cashier,' 'Kitchen,' 'Refill,' and 'Manager' (renamed to 'Manager' for users with the manager role) as per the user request.
- Subtle animations for feedback on button presses and sending orders as per the user request.