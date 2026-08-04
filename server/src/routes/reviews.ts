import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';

// Two-way ratings: after a completed booking each side reviews the other,
// once (unique per booking+direction). Ratings are standardized 1–5 with a
// per-category jsonb breakdown; aggregates are computed on read.

export function registerReviewRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string };
    Body: { rating?: number; categories?: Record<string, number>; comment?: string };
  }>('/v1/bookings/:id/review', async (request, reply) => {
    const user = requireUser(request);
    const { rating, categories, comment } = request.body ?? {};
    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      return reply.code(400).send({ error: 'rating must be 1–5' });
    }
    if (categories) {
      for (const v of Object.values(categories)) {
        if (typeof v !== 'number' || v < 1 || v > 5) {
          return reply.code(400).send({ error: 'category ratings must be 1–5' });
        }
      }
    }
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, client_id, creator_id, status')
      .eq('id', request.params.id)
      .maybeSingle();
    if (!booking) return reply.code(404).send({ error: 'Booking not found' });
    const isClient = user.id === booking.client_id;
    const isCreator = user.id === booking.creator_id;
    if (!isClient && !isCreator) return reply.code(403).send({ error: 'Not your booking' });
    if (booking.status !== 'completed') {
      return reply.code(409).send({ error: 'Reviews open once the booking is completed' });
    }
    const direction = isClient ? 'client_to_creator' : 'creator_to_client';
    const { error } = await supabaseAdmin.from('reviews').insert({
      booking_id: booking.id,
      client_id: booking.client_id,
      creator_id: booking.creator_id,
      rating,
      categories: categories ?? {},
      comment: comment?.trim() || null,
      direction,
    });
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'Already reviewed' });
      return reply.code(500).send({ error: error.message });
    }
    return reply.code(201).send({ reviewed: true });
  });

  // Aggregated ratings the signed-in user has RECEIVED, both directions.
  app.get('/v1/me/ratings', async (request) => {
    const user = requireUser(request);
    const agg = async (direction: string, column: string) => {
      const { data } = await supabaseAdmin
        .from('reviews')
        .select('rating, categories, comment, created_at')
        .eq(column, user.id)
        .eq('direction', direction)
        .order('created_at', { ascending: false })
        .limit(200);
      const rows = data ?? [];
      if (rows.length === 0) return { average: null, count: 0, categories: {}, recent: [] };
      const avg = rows.reduce((s, r) => s + Number(r.rating), 0) / rows.length;
      const catSums: Record<string, { sum: number; n: number }> = {};
      for (const r of rows) {
        for (const [k, v] of Object.entries((r.categories ?? {}) as Record<string, number>)) {
          catSums[k] = { sum: (catSums[k]?.sum ?? 0) + v, n: (catSums[k]?.n ?? 0) + 1 };
        }
      }
      return {
        average: Math.round(avg * 10) / 10,
        count: rows.length,
        categories: Object.fromEntries(
          Object.entries(catSums).map(([k, { sum, n }]) => [k, Math.round((sum / n) * 10) / 10]),
        ),
        recent: rows.slice(0, 10).map((r) => ({ rating: r.rating, comment: r.comment, created_at: r.created_at })),
      };
    };
    return {
      as_creator: await agg('client_to_creator', 'creator_id'),
      as_client: await agg('creator_to_client', 'client_id'),
    };
  });
}
