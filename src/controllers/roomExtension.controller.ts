import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const createRoomExtension = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      booking_id,
      new_checkout,
      additional_nights,
      additional_amount,
    } = req.body;

    // Get booking
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_id", booking_id)
      .single();

    if (bookingError || !booking) {
      return res.status(404).json({
        message: "Booking not found",
      });
    }

    // Create extension record
    const { data, error } = await supabase
      .from("room_extensions")
      .insert([
        {
          booking_id,
          current_checkout: booking.check_out,
          new_checkout,
          additional_nights,
          additional_amount,
        },
      ])
      .select();

    if (error) throw error;

    // Update booking checkout date
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        check_out: new_checkout,
        nights: booking.nights + additional_nights,
        total_amount:
          Number(booking.total_amount) +
          Number(additional_amount),
      })
      .eq("booking_id", booking_id);

    if (updateError) throw updateError;

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to extend booking",
      error,
    });
  }
};

export const getRoomExtensions = async (
  req: Request,
  res: Response
) => {
  try {
    const { data, error } = await supabase
      .from("room_extensions")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (error) throw error;

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch extensions",
      error,
    });
  }
};