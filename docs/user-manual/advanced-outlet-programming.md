# Advanced Outlet Programming

Advanced Outlet Programming lets an outlet make automatic ON/OFF decisions from time, aquarium measurements, Feed Cycles, Water Change mode, other equipment, or a repeating interval. Programs run locally on the Reef Controller, so they continue operating when the tablet or internet connection is unavailable.

Use an Advanced program when a normal schedule or Always On setting cannot describe the behavior you need. Keep life-support equipment on the simplest program that safely meets its needs.

> **Safety first:** Test a new program with noncritical equipment, conservative limits, and `MISSING DATA OFF`. Confirm the physical outlet several times before relying on the program unattended.

## Open the editor

1. Open **Equipment** and select the outlet.
2. Set its control mode to **AUTO**.
3. In **AUTO Program**, open **Type** and choose **Advanced**.
4. Enter the program in the **Configuration** editor.
5. Select **Save Advanced Program** and wait for confirmation from the Reef Controller.

The editor uses one readable command per line. Commands are case-insensitive, and lines beginning with `#` are comments. Keywords, states, values, and comments are shown in different colors. The status below the editor shows the number of rules and identifies the first invalid line.

An invalid program cannot be saved and does not replace the program currently running on the Reef Controller.

## IF/THEN behavior

Every control rule has this form:

```text
IF condition THEN ON
IF condition THEN OFF
```

The Reef Controller starts with `DEFAULT` and evaluates every IF rule from top to bottom. If several rules match, **the last matching IF rule executes**. Put broad operating rules first and shutdowns or other exceptions last.

There is no separate ELSE command. `DEFAULT` acts as ELSE when no rules match.

```text
DEFAULT OFF

IF TIME 08:00 TO 20:00 THEN ON
IF TEMPERATURE > 82 THEN OFF
```

At 14:00 and 83 °F, both rules match. The temperature rule is last, so the result is OFF.

## Command reference

Square brackets in this reference indicate optional text; do not type the brackets.

### Program commands

| Syntax | What it does |
| --- | --- |
| `DEFAULT ON` | Uses ON when no IF rule matches. |
| `DEFAULT OFF` | Uses OFF when no IF rule matches. |
| `MISSING DATA ON` | Uses ON if an enabled rule cannot obtain required data. |
| `MISSING DATA OFF` | Uses OFF if an enabled rule cannot obtain required data. This is the recommended starting point. |
| `# comment` | Adds a note that is ignored by the controller. |

### IF condition commands

| Syntax | What it does |
| --- | --- |
| `IF TIME 08:00 TO 20:00 THEN ON` | Matches a local time range every day. Times use 24-hour `HH:MM`. |
| `IF TIME 08:00 TO 20:00 DAYS MON,TUE,WED,THU,FRI THEN ON` | Matches a local time range only on the listed days. Valid days are `SUN` through `SAT`. |
| `IF FEED A THEN OFF` | Matches while Feed Cycle A is active. Cycles A, B, and C are supported. |
| `IF WATER CHANGE THEN OFF` | Matches while Water Change mode is active. |
| `IF TEMPERATURE > 82 THEN OFF` | Compares the current temperature in °F with a threshold. `TEMP` is also accepted. |
| `IF PH < 7.9 THEN OFF` | Compares the current pH with a threshold. |
| `IF ORP > 450 THEN OFF` | Compares the current ORP in mV with a threshold. |
| `IF SALINITY < 34 THEN OFF` | Compares the current salinity in ppt with a threshold. |
| `IF EQUIPMENT "return-pump" IS ON THEN ON` | Matches the ON or OFF state of another equipment ID. Quotes allow IDs containing spaces. |
| `IF REPEAT ON 120 OFF 480 THEN ON` | Matches for 120 seconds, does not match for 480 seconds, and repeats from local midnight. |
| `IF REPEAT ON 120 OFF 480 OFFSET 3600 THEN ON` | Starts the repeating cycle 3,600 seconds after local midnight. |

The available comparison operators are `>` and `<`. Measurement units are implied by the measurement name and must match the data supplied by the Reef Controller.

### Safety commands

| Syntax | What it does |
| --- | --- |
| `DEFER ON 300` | Requires a continuous ON request for 300 seconds before turning on. |
| `DEFER OFF 300` | Requires a continuous normal OFF request for 300 seconds before turning off. |
| `MINIMUM ON 300` | Prevents a normal OFF transition until the outlet has been on for 300 seconds. |
| `MINIMUM OFF 300` | Prevents an ON transition until the outlet has been off for 300 seconds. |
| `MAXIMUM CONTINUOUS ON 3600` | Forces OFF after one uninterrupted 3,600-second ON period. |
| `MAXIMUM DAILY ON 43200` | Forces OFF after 43,200 accumulated ON seconds during the local day. |
| `MAXIMUM CHANGES PER HOUR 6` | Delays additional ON transitions after the hourly transition limit is reached. |

All durations are whole seconds. Omit an optional safety command when no limit is required. A zero value is valid for `DEFER` and `MINIMUM`; maximum values must be greater than zero.

Safety shutdowns caused by `MISSING DATA OFF`, maximum continuous runtime, or maximum daily runtime go directly to OFF and bypass normal delay and minimum-time settings.

## Time and day rules

The start time is included and the end time is excluded.

- `IF TIME 08:00 TO 20:00 THEN ON` matches from 8:00 AM until just before 8:00 PM.
- `IF TIME 20:00 TO 08:00 THEN ON` crosses midnight and matches overnight.
- Adding `DAYS MON,TUE,WED,THU,FRI` restricts the rule to those controller-local weekdays.

The Reef Controller's local clock and time zone determine when Time and Repeat rules run.

## Feed Cycle and Water Change priority

Feed Cycle and Water Change actions have priority over Advanced programs for equipment included in the active routine. This prevents an Advanced program from undoing a deliberate shutdown.

A Feed or Water Change IF rule is useful for controlling an outlet that is not directly included in the routine, such as an indicator or auxiliary device.

## Equipment rules

Use the referenced equipment's stable ID, not only its display name. Renaming equipment does not change its ID. If the equipment is removed or its state is unavailable, the program uses `MISSING DATA`.

```text
DEFAULT OFF
MISSING DATA OFF

IF EQUIPMENT "return-pump" IS ON THEN ON
DEFER ON 300
```

This program turns the outlet on after the return pump has remained on for five minutes. It returns to the default OFF state when the return pump is off.

## Measurement rules

Measurement rules do not add a separate hysteresis threshold. Use `DEFER`, `MINIMUM`, and `MAXIMUM CHANGES PER HOUR` to prevent rapid cycling near a threshold.

```text
DEFAULT OFF
MISSING DATA OFF

IF TEMPERATURE > 80 THEN ON

DEFER ON 60
MINIMUM ON 300
MINIMUM OFF 300
MAXIMUM CHANGES PER HOUR 6
```

This is time-based anti-chatter protection. Verify threshold-driven equipment around the chosen setpoint before leaving it unattended.

## Repeat rules

A Repeat condition matches only during its ON phase. Use `DEFAULT OFF` for a normal repeating ON/OFF cycle.

```text
DEFAULT OFF

# Two minutes on, eight minutes off
IF REPEAT ON 120 OFF 480 THEN ON

MAXIMUM CHANGES PER HOUR 12
```

Do not set `MINIMUM ON` or `MINIMUM OFF` longer than the intended phase unless you deliberately want the safety timing to stretch the cycle.

## Complete examples

### Refugium light with high-temperature shutdown

```text
# Reverse daylight refugium schedule
DEFAULT OFF
MISSING DATA OFF

IF TIME 20:00 TO 08:00 THEN ON
IF TEMPERATURE > 82 THEN OFF

DEFER ON 300
DEFER OFF 300
```

The temperature rule is last, so it overrides the nighttime rule whenever both match.

### Weekday-only auxiliary equipment

```text
DEFAULT OFF
MISSING DATA OFF

IF TIME 09:00 TO 17:00 DAYS MON,TUE,WED,THU,FRI THEN ON

MINIMUM ON 60
MINIMUM OFF 60
```

### Feed Cycle indicator

```text
DEFAULT OFF

IF FEED A THEN ON
IF FEED B THEN ON
IF FEED C THEN ON
```

Any active Feed Cycle turns the indicator on. Because all matching rules request the same state, their order does not matter.

## Program priority and manual control

The effective order is:

1. Active Feed Cycle, Water Change, or applicable custom-routine action
2. Advanced program safety limits
3. The last matching IF rule executes
4. `DEFAULT` when no IF rule matches

An Advanced program runs only while the equipment is in AUTO. Manual control takes the equipment out of automatic program control. Return it to AUTO when you want the program to resume.

## Test a program safely

1. Confirm that the outlet's AUTO program type is Advanced.
2. Begin with `DEFAULT OFF` and `MISSING DATA OFF` unless ON is clearly safer.
3. Temporarily use short, observable Time or Repeat values.
4. Correct every line reported by the editor before saving.
5. Save and wait for the Reef Controller confirmation message.
6. Confirm the physical outlet—not only the on-screen state—changes as expected.
7. Test no-match behavior, every matching rule, overlapping rules, and missing data.
8. Test Feed Cycle and Water Change priority if either routine includes the outlet.
9. Restore the intended production times and safety limits, then save again.

## Troubleshooting

**The program cannot be saved**

- Read the line number displayed below the editor.
- Use one complete command per line.
- Times must use valid 24-hour `HH:MM` values.
- Repeat ON and OFF durations must be positive whole seconds.
- Safety durations must be nonnegative whole seconds; maximum limits must be positive.

**The program saved but the outlet does not change**

- Confirm the equipment is in AUTO.
- Check whether a Feed Cycle, Water Change, or custom routine controls the outlet.
- Check `DEFER` and `MINIMUM`; the transition may still be waiting.
- Confirm a maximum runtime or transition limit has not been reached.

**The wrong IF rule executes**

- Remember that the last matching IF rule executes.
- Move shutdowns and other exceptions below general operating rules.

**A Time rule runs at the wrong time**

- Confirm the Reef Controller's local time and time zone.
- Check 24-hour times and optional `DAYS` values.
- Remember that an overnight range crosses midnight.

**A measurement or equipment rule uses MISSING DATA**

- Confirm the sensor or referenced equipment is online and reporting.
- Confirm the measurement has the expected units.
- Confirm an Equipment rule contains the stable equipment ID.

**The Reef Controller does not confirm the revision**

- Verify the controller connection and try saving again. The prior confirmed revision remains active until the new revision is accepted.
