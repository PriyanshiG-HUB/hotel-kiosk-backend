import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const checkoutGuest = async (
  req: Request,
  res: Response
) => {
  try {
    const { booking_id } = req.body;

    const { data: booking, error: bookingError } =
      await supabase
        .from("bookings")
        .select("*")
        .eq("booking_id", booking_id)
        .single();

    if (bookingError || !booking) {
      return res.status(404).json({
        message: "Booking not found",
      });
    }

    if (booking.checked_out || booking.booking_status === "completed") {
      return res.status(400).json({
        message: "Guest already checked out",
      });
    }

    const { error: bookingUpdateError } = await supabase
      .from("bookings")
      .update({
        checked_out: true,
        booking_status: "completed",
        checked_out_at: new Date().toISOString(),
      })
      .eq("booking_id", booking_id);

    if (bookingUpdateError) {
      return res.status(500).json({
        message: "Failed to update booking checkout status",
        error: bookingUpdateError.message,
      });
    }

    const { error: roomUpdateError } = await supabase
      .from("rooms")
      .update({
        status: "available",
      })
      .eq("room_id", booking.room_id);

    if (roomUpdateError) {
      return res.status(500).json({
        message: "Failed to update room status",
        error: roomUpdateError.message,
      });
    }

    res.json({
      message: "Checkout completed successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};