import { Router } from "express";
import {
  createRoomExtension,
  getRoomExtensions,
} from "../controllers/roomExtension.controller";

const router = Router();

router.post("/", createRoomExtension);
router.get("/", getRoomExtensions);

export default router;