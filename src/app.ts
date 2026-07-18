import express from "express";
import cors from "cors";
import roomRoutes from "./routes/room.routes";
import guestRoutes from "./routes/guest.routes";
import bookingRoutes from "./routes/booking.routes";
import paymentRoutes from "./routes/payment.routes";
import checkoutRoutes from "./routes/checkout.routes";
import visitorRoutes from "./routes/visitor.routes";
import serviceRoutes from "./routes/service.routes";
import roomExtensionRoutes from "./routes/roomExtension.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import helpRoutes from "./routes/help.routes";
const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`, req.body);
  next();
});

app.get("/", (req, res) => {
  res.send("Hotel Kiosk Backend Running");
});
app.use("/api/rooms", roomRoutes);
app.use("/api/guests", guestRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/visitors", visitorRoutes);
app.use("/api/service-requests", serviceRoutes);
app.use("/api/room-extensions", roomExtensionRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/help", helpRoutes);
export default app;