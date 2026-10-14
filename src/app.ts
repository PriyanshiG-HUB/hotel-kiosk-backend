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
import idVerificationRoutes from "./routes/idVerification.routes";
import checkInRoutes from "./routes/checkin.routes";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Safe privacy-conscious request logging (masks sensitive ID details and staff credentials)
app.use((req, res, next) => {
  let logBody = { ...req.body };
  if (logBody.idNumber) logBody.idNumber = "***MASKED***";
  if (logBody.id_number) logBody.id_number = "***MASKED***";
  if (logBody.documentNumber) logBody.documentNumber = "***MASKED***";
  if (logBody.documentNumberMasked) logBody.documentNumberMasked = "***MASKED***";
  if (logBody.staffPin) logBody.staffPin = "***MASKED***";
  if (logBody.pin) logBody.pin = "***MASKED***";
  console.log(`${req.method} ${req.path}`, logBody);
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
app.use("/api/id-verification", idVerificationRoutes);
app.use("/api/check-in", checkInRoutes);
export default app;