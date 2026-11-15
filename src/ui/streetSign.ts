/**
 * When the HUD's green street sign shows, and with which name (Hud.tsx). The street under
 * the car is looked up a few times a second, and fed in here:
 * - a new name only counts once the car has stayed on it for `settle` seconds, so driving
 *   through a junction, or poking into a side street and backing out, doesn't flick the
 *   sign back and forth;
 * - the sign shows for `shown` seconds, then fades;
 * - coming back onto a street whose sign showed less than `again` seconds ago switches the
 *   name quietly, without showing the sign again;
 * - unnamed roads (no name in the data) keep the last name.
 */
export const STREET_SIGN = { settle: 1, shown: 4, again: 20 };

export class StreetSign {
  /** The street the sign is for, and whether it's showing. */
  name = '';
  shown = false;
  private shownAt = 0;
  private pending = '';
  private pendingSince = 0;
  private lastShown = new Map<string, number>();

  /** The street under the car (undefined if unnamed) at time `t` (seconds). True if the sign changed. */
  update(street: string | undefined, t: number): boolean {
    let changed = false;
    if (street === this.name) this.pending = '';
    else if (street) {
      if (street !== this.pending) [this.pending, this.pendingSince] = [street, t];
      else if (t - this.pendingSince >= STREET_SIGN.settle) {
        const recent = t - (this.lastShown.get(street) ?? -Infinity) < STREET_SIGN.again;
        this.name = street;
        this.pending = '';
        this.shown = !recent;
        if (this.shown) {
          this.shownAt = t;
          this.lastShown.set(street, t);
        }
        return true;
      }
    }
    if (this.shown && t - this.shownAt > STREET_SIGN.shown) {
      this.shown = false;
      changed = true;
    }
    return changed;
  }
}
