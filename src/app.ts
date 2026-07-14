import express from "express";
import cors from "cors";
import roomRoutes from "./routes/room.routes";
import guestRoutes from "./routes/guest.routes";
import bookingRoutes from "./routes/booking.routes";
import paymentRoutes from "./routes/payment.routes";
import checkoutRoutes from "./routes/checkout.routes";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hotel Kiosk Backend Running");
});
app.use("/api/rooms", roomRoutes);
app.use("/api/guests", guestRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/checkout", checkoutRoutes);
export default app;