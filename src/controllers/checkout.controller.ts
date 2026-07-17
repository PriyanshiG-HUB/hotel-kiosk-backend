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
    if (booking.checked_out) {
  return res.status(400).json({
    message: "Guest already checked out",
  });
}
    if (bookingError || !booking) {
      return res.status(404).json({
        message: "Booking not found",
      });
    }

    await supabase
      .from("bookings")
      .update({
        checked_out: true,
        booking_status: "completed",
        checked_out_at: new Date().toISOString(),
      })
      .eq("booking_id", booking_id);

    await supabase
      .from("rooms")
      .update({
        status: "available",
      })
      .eq("room_id", booking.room_id);

    res.json({
      message: "Checkout completed successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};