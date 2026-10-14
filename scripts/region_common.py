"""Region identifiers and supported US administrative scope for build tools."""
import argparse
import re

US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split()

def region_name(value):
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,47}', value):
        raise argparse.ArgumentTypeError('Use a lowercase region slug, at most 48 characters')
    return value
