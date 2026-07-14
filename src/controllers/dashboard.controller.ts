import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const getDashboardStats = async (
  req: Request,
  res: Response
) => {
  try {
    const { count: totalRooms } = await supabase
      .from("rooms")
      .select("*", { count: "exact", head: true });

    const { count: occupiedRooms } = await supabase
      .from("rooms")
      .select("*", { count: "exact", head: true })
      .eq("status", "occupied");

    const { count: availableRooms } = await supabase
      .from("rooms")
      .select("*", { count: "exact", head: true })
      .eq("status", "available");

    const { count: activeVisitors } = await supabase
      .from("visitors")
      .select("*", { count: "exact", head: true })
      .eq("status", "checked_in");

    const { count: pendingRequests } = await supabase
      .from("service_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    const { count: activeBookings } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("booking_status", "confirmed");

    return res.status(200).json({
      totalRooms: totalRooms || 0,
      occupiedRooms: occupiedRooms || 0,
      availableRooms: availableRooms || 0,
      activeBookings: activeBookings || 0,
      activeVisitors: activeVisitors || 0,
      pendingRequests: pendingRequests || 0,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch dashboard statistics",
      error,
    });
  }
};