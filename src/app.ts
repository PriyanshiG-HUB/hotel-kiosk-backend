import express from "express";
import cors from "cors";
import roomRoutes from "./routes/room.routes";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hotel Kiosk Backend Running");
});

app.use("/api/rooms", roomRoutes);

export default app;