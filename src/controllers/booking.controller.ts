import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const createBooking = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      guest_id,
      room_id,
      check_in,
      check_out,
      nights,
      total_amount,
    } = req.body;

    // Check room status
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("room_id", room_id)
      .single();

    if (roomError || !room) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    if (room.status !== "available") {
      return res.status(400).json({
        message: "Room is already occupied",
      });
    }

    // Create booking
    const { data, error } = await supabase
      .from("bookings")
      .insert([
        {
          guest_id,
          room_id,
          check_in,
          check_out,
          nights,
          total_amount,
        },
      ])
      .select();

    if (error) {
      return res.status(500).json(error);
    }

    // Update room status
    await supabase
      .from("rooms")
      .update({
        status: "occupied",
      })
      .eq("room_id", room_id);

    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getBookingById = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("bookings")
      .select(`
        *,
        guests (
          full_name,
          mobile,
          email
        ),
        rooms (
          room_number,
          room_type
        )
      `)
      .eq("booking_id", id)
      .limit(1);

    if (error || !data) {
      return res.status(404).json({
        message: "Booking not found",
      });
    }

    res.json(data[0]);
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getBookingsByMobile = async (
  req: Request,
  res: Response
) => {
  try {
    const { mobile } = req.params;

    const { data, error } = await supabase
      .from("bookings")
      .select(`
        booking_id,
        booking_status,
        check_in,
        check_out,
        total_amount,
        guests!inner (
          full_name,
          mobile,
          email
        ),
        rooms (
          room_number,
          room_type
        )
      `)
      .eq("guests.mobile", mobile)
      .eq("booking_status", "confirmed")
      .single();

    if (error || !data) {
      return res.status(404).json({
        message: "No booking found",
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getBookingByRoom = async (
  req: Request,
  res: Response
) => {
  try {
    const { roomNo } = req.params;

    const { data, error } = await supabase
      .from("bookings")
      .select(`
        booking_id,
        booking_status,
        check_in,
        check_out,
        total_amount,
        guests (
          full_name,
          mobile,
          email
        ),
        rooms!inner (
          room_number,
          room_type
        )
      `)
      .eq("rooms.room_number", roomNo)
      .eq("booking_status", "confirmed")
      .single();

    console.log(
      "Room Search Result:",
      data,
      error
    );

    if (error || !data) {
      return res.status(404).json({
        message: "No booking found",
      });
    }

    res.json(data);
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};