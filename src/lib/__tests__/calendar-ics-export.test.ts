import { describe, it, expect } from 'vitest';
import type { CalendarEvent } from '../../api/types';
import { eventToICS, getMeetingLink, icsFilename } from '../calendar-ics-export';

const event: CalendarEvent = {
  id: 'ev1',
  uid: 'uid-1',
  title: 'Team sync; weekly',
  description: 'Line 1\nLine 2',
  calendarIds: { 'cal-1': true },
  start: '2026-03-02T09:00:00',
  timeZone: 'Europe/Berlin',
  utcEnd: '2026-03-02T08:30:00Z',
  duration: 'PT30M',
  status: 'confirmed',
  organizerCalendarAddress: 'mailto:alice@example.com',
  participants: {
    a: { calendarAddress: 'mailto:alice@example.com', name: 'Alice' },
    b: { calendarAddress: 'mailto:bob@example.com', name: 'Bob', roles: { attendee: true }, expectReply: true },
  },
  recurrenceRules: [{ frequency: 'weekly', interval: 2, byDay: [{ day: 'mo' }] }],
  alerts: { r1: { trigger: { '@type': 'OffsetTrigger', offset: '-PT15M' }, action: 'display' } },
  virtualLocations: { v: { uri: 'https://meet.example.com/abc' } },
};

describe('eventToICS', () => {
  it('serialises a timed event with zone, organizer, attendees, rule and alarm', () => {
    const ics = eventToICS(event);
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('PRODID:-//ZyndMail//EN\r\n');
    expect(ics).toContain('UID:uid-1');
    expect(ics).toContain('DTSTART;TZID=Europe/Berlin:20260302T090000');
    expect(ics).toContain('DTEND:20260302T083000Z');
    expect(ics).toContain('SUMMARY:Team sync\\; weekly');
    expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2');
    expect(ics).toContain('ORGANIZER;CN=Alice:mailto:alice@example.com');
    expect(ics).toContain('ATTENDEE;CN=Bob;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:bob@example.com');
    expect(ics).not.toContain('ATTENDEE;CN=Alice');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
    expect(ics).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M');
    expect(ics).toContain('URL:https://meet.example.com/abc');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('writes all-day events as DATE values with a duration', () => {
    const ics = eventToICS({ ...event, showWithoutTime: true, start: '2026-03-02T00:00:00', duration: 'P2D', utcEnd: undefined });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260302');
    expect(ics).toContain('DURATION:P2D');
    expect(ics).not.toContain('DTEND');
  });

  it('folds long lines at 74 octets', () => {
    const ics = eventToICS({ ...event, description: 'x'.repeat(200) });
    const long = ics.split('\r\n').filter((l) => l.length > 75);
    expect(long).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('builds a safe filename and finds the meeting link', () => {
    expect(icsFilename(event)).toBe('Team-sync-weekly.ics');
    expect(icsFilename({ ...event, title: '' })).toBe('event.ics');
    expect(getMeetingLink(event)).toBe('https://meet.example.com/abc');
    expect(getMeetingLink({ virtualLocations: undefined })).toBeNull();
  });
});
