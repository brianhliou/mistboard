-- 141_mahjong_room_seats.sql
-- Let a room seat token name a wind.
--
-- Migration 029 widened this from ('white','black') to include 'red' when
-- xiangqi arrived. Mahjong widens it again, for the same reason and with the
-- same shape: a seat token is how a player reclaims their seat after a
-- reconnect, and a mahjong seat is east, south, west or north.
--
-- Without this, a mahjong room works until somebody refreshes the page. The
-- insert fails the CHECK, the seat token is never stored, and the player comes
-- back as a spectator at a table holding their hand.

ALTER TABLE room_seat_tokens
  DROP CONSTRAINT IF EXISTS room_seat_tokens_seat_check,
  ADD CONSTRAINT room_seat_tokens_seat_check
  CHECK (seat IN ('white', 'black', 'red', 'east', 'south', 'west', 'north'));
