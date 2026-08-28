#!/usr/bin/env python3
"""Read-only probe for the Jebao/Jecod MDP local TCP handshake.

The default mode performs no provisioning or control commands. It requests the
pump-issued LAN passcode, uses it immediately to authenticate, then prints the
current state without revealing the passcode. The explicit ``--control-test``
option runs a reversible power/speed check and restores the starting state.

Handshake and framing method independently reviewed from python-jebao 0.1.7
(MIT): https://github.com/jrigling/python-jebao
"""

from __future__ import annotations

import argparse
import ipaddress
import socket
import sys
import time
from dataclasses import dataclass


MAGIC = b"\x00\x00\x00\x03"
PASSCODE_REQUEST = bytes.fromhex("00000003050000060100")
STATUS_REQUEST = bytes.fromhex("000000030400009002")
PASSCODE_RESPONSE = 0x07
LOGIN_SUCCESS = 0x09
EXTENDED_STATUS = 0x00
SIMPLE_STATUS = 0x91
CONTROL_ACK = 0x94
EXTENDED_STATUS_PADDING_LENGTH = 129
KNOWN_STATES = {
    0x10: "off",
    0x11: "on",
    0x15: "feed",
    0x19: "program",
}


class ProbeError(RuntimeError):
    """Expected probe failure with a user-facing explanation."""


@dataclass(frozen=True)
class Frame:
    data: bytes
    message_type: int
    extended_data: bytes = b""


@dataclass(frozen=True)
class PumpState:
    state_byte: int
    speed: int

    @property
    def name(self) -> str:
        return KNOWN_STATES.get(self.state_byte, f"unknown-0x{self.state_byte:02x}")

    @property
    def powered_on(self) -> bool:
        return self.state_byte in {0x11, 0x15}


def parse_host(value: str) -> str:
    try:
        address = ipaddress.ip_address(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("host must be a literal IPv4 address") from error
    if address.version != 4:
        raise argparse.ArgumentTypeError("host must be an IPv4 address")
    return str(address)


def receive_exact(connection: socket.socket, length: int) -> bytes:
    chunks: list[bytes] = []
    remaining = length
    while remaining:
        chunk = connection.recv(remaining)
        if not chunk:
            raise ProbeError("pump closed the TCP connection")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def receive_frame(connection: socket.socket) -> Frame:
    header = receive_exact(connection, 5)
    if header[:4] != MAGIC:
        raise ProbeError(f"unexpected frame signature {header[:4].hex()}")

    data = header + receive_exact(connection, header[4])
    if len(data) < 8:
        raise ProbeError(f"frame is too short ({len(data)} bytes)")
    message_type = data[7]

    # Some MDP firmware appends a fixed padding block after extended status.
    extended_data = b""
    if message_type == EXTENDED_STATUS:
        extended_data = receive_exact(connection, EXTENDED_STATUS_PADDING_LENGTH)

    return Frame(data=data, message_type=message_type, extended_data=extended_data)


def receive_until(
    connection: socket.socket,
    expected_types: set[int],
    maximum_frames: int = 5,
) -> Frame:
    observed: list[str] = []
    for _ in range(maximum_frames):
        frame = receive_frame(connection)
        observed.append(f"0x{frame.message_type:02x}")
        if frame.message_type in expected_types:
            return frame
    raise ProbeError(
        "expected message type not received; observed " + ", ".join(observed)
    )


def build_login(passcode: bytes) -> bytes:
    if len(passcode) != 10:
        raise ProbeError(f"pump returned a {len(passcode)}-byte passcode; expected 10")
    return bytes.fromhex("000000030f000008000a") + passcode


def build_control(
    sequence: int,
    opcode1: int,
    opcode2: int = 0,
    param1: int = 0,
    param2: int = 0,
) -> bytes:
    frame = bytearray(323)
    frame[:4] = MAGIC
    frame[4] = 0xBD
    frame[5] = 0x02
    frame[8] = 0x93
    frame[9:13] = sequence.to_bytes(4, "big")
    frame[13] = 0x01
    frame[21:25] = bytes((opcode1, opcode2, param1, param2))
    return bytes(frame)


def read_status(connection: socket.socket, dump_status: bool = False) -> PumpState:
    connection.sendall(STATUS_REQUEST)
    response = receive_until(connection, {SIMPLE_STATUS, EXTENDED_STATUS})
    if len(response.data) < 12:
        raise ProbeError(f"status response is too short ({len(response.data)} bytes)")
    if dump_status:
        print(f"STATUS_FRAME_HEX={response.data.hex()}")
        print(f"STATUS_EXTENDED_HEX={response.extended_data.hex()}")
    return PumpState(state_byte=response.data[10], speed=response.data[11])


def send_control(connection: socket.socket, frame: bytes) -> None:
    connection.sendall(frame)
    receive_until(connection, {CONTROL_ACK})
    # The pump can send a status update after its ACK. A fresh status request is
    # authoritative, so let any update arrive and consume it before querying.
    time.sleep(0.35)
    previous_timeout = connection.gettimeout()
    connection.settimeout(0.1)
    try:
        receive_frame(connection)
    except (TimeoutError, socket.timeout):
        pass
    finally:
        connection.settimeout(previous_timeout)


def wait_for_state(
    connection: socket.socket,
    predicate,
    description: str,
    attempts: int = 5,
) -> PumpState:
    state: PumpState | None = None
    for _ in range(attempts):
        state = read_status(connection)
        if predicate(state):
            return state
        time.sleep(0.4)
    observed = "none" if state is None else f"state={state.name}, speed={state.speed}%"
    raise ProbeError(f"pump did not reach {description}; last observed {observed}")


def run_control_test(connection: socket.socket, starting: PumpState) -> None:
    sequence = 1
    print(
        f"CONTROL TEST: starting state={starting.name}, speed={starting.speed}%"
    )
    try:
        send_control(connection, build_control(sequence, 0x01, opcode2=0x01))
        sequence += 1
        state = wait_for_state(
            connection, lambda value: value.powered_on, "powered on"
        )
        print(f"PASS: pump turned on (speed={state.speed}%)")

        send_control(connection, build_control(sequence, 0x20, param1=35))
        sequence += 1
        wait_for_state(connection, lambda value: value.speed == 35, "35% speed")
        print("PASS: pump reached 35%")
    finally:
        print("RESTORE: returning pump to its starting speed and power state")
        try:
            send_control(
                connection,
                build_control(sequence, 0x20, param1=starting.speed),
            )
            sequence += 1
            wait_for_state(
                connection,
                lambda value: value.speed == starting.speed,
                f"original {starting.speed}% speed",
            )
            send_control(
                connection,
                build_control(
                    sequence,
                    0x01,
                    opcode2=0x01 if starting.powered_on else 0x00,
                ),
            )
            restored = wait_for_state(
                connection,
                lambda value: (
                    value.state_byte == starting.state_byte
                    and value.speed == starting.speed
                ),
                f"original {starting.name}/{starting.speed}% state",
            )
            print(
                f"PASS: restored state={restored.name}, speed={restored.speed}%"
            )
        except Exception as restore_error:
            raise ProbeError(f"automatic restoration failed: {restore_error}") from restore_error


def run_probe(
    host: str,
    port: int,
    timeout: float,
    control_test: bool,
    dump_status: bool,
) -> None:
    print(f"Connecting to {host}:{port} ...")
    with socket.create_connection((host, port), timeout=timeout) as connection:
        connection.settimeout(timeout)

        connection.sendall(PASSCODE_REQUEST)
        response = receive_until(connection, {PASSCODE_RESPONSE})
        if len(response.data) < 20:
            raise ProbeError(
                f"passcode response is too short ({len(response.data)} bytes)"
            )
        passcode = response.data[10:20]
        printable = all(0x21 <= byte <= 0x7E for byte in passcode)
        print(
            "PASS: pump returned a 10-byte LAN passcode "
            f"(value redacted, printable={str(printable).lower()})"
        )

        connection.sendall(build_login(passcode))
        receive_until(connection, {LOGIN_SUCCESS})
        print("PASS: pump accepted the freshly requested passcode")

        status = read_status(connection, dump_status=dump_status)
        print(
            f"PASS: read-only status succeeded (state={status.name}, speed={status.speed}%)"
        )
        if control_test:
            run_control_test(connection, status)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Test the read-only MDP passcode/login/status sequence."
    )
    parser.add_argument("host", type=parse_host, help="pump IPv4 address")
    parser.add_argument("--port", type=int, default=12416, help="TCP port (default: 12416)")
    parser.add_argument(
        "--timeout", type=float, default=5.0, help="socket timeout in seconds (default: 5)"
    )
    parser.add_argument(
        "--dump-status",
        action="store_true",
        help="print the authenticated status frame and extended status bytes as hex",
    )
    parser.add_argument(
        "--control-test",
        action="store_true",
        help="turn on, test 35%% speed, and restore the original state",
    )
    args = parser.parse_args()

    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    if args.timeout <= 0:
        parser.error("timeout must be greater than zero")

    try:
        run_probe(
            args.host,
            args.port,
            args.timeout,
            args.control_test,
            args.dump_status,
        )
    except (OSError, ProbeError) as error:
        print(f"FAILED: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
