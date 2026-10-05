"""Meter-equivalent carrying penalty per complete OSM stair way, not per graph edge."""
import math,re
def flight_policy(tags,length):
    if not math.isfinite(length) or length<=0:raise ValueError('Invalid physical stair-way length')
    raw=tags.get('step_count','');count=int(raw) if re.fullmatch(r'[1-9][0-9]{0,3}',raw) else None
    # Reject impossible/extreme geometry-to-count ratios; long landings are allowed.
    if count is not None and not .1<=length/count<=5:count=None
    channel=tags.get('ramp:bicycle') in ('yes','left','right','both')
    if count is not None:
        penalty=2*count if count<=20 else 240+8*(count-20)
        mode='tagged-count'
    else:
        # Length is a fallback burden proxy, NEVER a measured or estimated step count.
        penalty=20+4*length if length<=3 else 250+5*length
        mode='unknown-count-short-link' if length<=3 else 'unknown-count-conservative'
    if channel:penalty*=.5 # A channel helps push a bicycle; it does not make stairs rideable.
    return {'penalty_m':penalty,'trusted_step_count':count,'raw_step_count':raw or None,
            'mode':mode,'bicycle_channel':channel,'length_m':length}
