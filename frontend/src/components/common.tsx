import { ActionIcon, Badge, Box, CopyButton, Group, Modal, Paper, Progress, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconCheck, IconCopy, IconQrcode } from '@tabler/icons-react';
import { QRCodeSVG } from 'qrcode.react';
import type { ReactNode } from 'react';

import { bytes } from '@/lib/format';
import { PROTOCOL_META, type Protocol, type User, type UserStatus } from '@/lib/types';

const STATUS_COLOR: Record<UserStatus, string> = { ACTIVE: 'teal', DISABLED: 'gray', LIMITED: 'orange', EXPIRED: 'red' };

export function StatusBadge({ status, blocked }: { status: UserStatus; blocked?: boolean }) {
    if (blocked) return <Badge color="yellow" variant="light">IP blocked</Badge>;
    return (
        <Badge color={STATUS_COLOR[status]} variant="light">
            {status}
        </Badge>
    );
}

export function OnlineDot({ onlineAt }: { onlineAt: number | null }) {
    const online = !!onlineAt && Date.now() - onlineAt < 60_000;
    return (
        <Box
            w={8}
            h={8}
            style={{ borderRadius: 8, flex: 'none', background: online ? 'var(--mantine-color-teal-5)' : 'var(--mantine-color-dark-3)', boxShadow: online ? '0 0 6px var(--mantine-color-teal-5)' : undefined }}
        />
    );
}

export function ProtocolBadge({ protocol }: { protocol: Protocol }) {
    const meta = PROTOCOL_META[protocol];
    return (
        <Badge size="xs" variant="dot" color={meta.color}>
            {meta.label}
        </Badge>
    );
}

export function Copy({ value, size = 'md' }: { value: string; size?: 'sm' | 'md' }) {
    return (
        <CopyButton value={value} timeout={1500}>
            {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
                    <ActionIcon variant="light" color={copied ? 'teal' : 'gray'} onClick={copy} size={size === 'sm' ? 'sm' : 'md'}>
                        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                </Tooltip>
            )}
        </CopyButton>
    );
}

export function QrButton({ value, title }: { value: string; title: string }) {
    const [opened, { open, close }] = useDisclosure();
    return (
        <>
            <Tooltip label="QR code" withArrow>
                <ActionIcon variant="light" color="gray" onClick={open}>
                    <IconQrcode size={14} />
                </ActionIcon>
            </Tooltip>
            <Modal opened={opened} onClose={close} title={title} centered size="auto">
                <Stack align="center">
                    <Box p="md" bg="white" style={{ borderRadius: 12 }}>
                        <QRCodeSVG value={value} size={280} level="M" />
                    </Box>
                    <Text size="xs" c="dimmed" maw={300} className="mono" lineClamp={3}>
                        {value}
                    </Text>
                </Stack>
            </Modal>
        </>
    );
}

export function LinkRow({ label, value, badge, qr = true }: { label: string; value: string; badge?: ReactNode; qr?: boolean }) {
    return (
        <Paper withBorder p="xs" radius="md">
            <Group justify="space-between" wrap="nowrap" gap="xs">
                <Box style={{ minWidth: 0, flex: 1 }}>
                    <Group gap={6} mb={2}>
                        <Text size="sm" fw={600}>
                            {label}
                        </Text>
                        {badge}
                    </Group>
                    <Text size="xs" c="dimmed" className="mono" lineClamp={1}>
                        {value}
                    </Text>
                </Box>
                <Group gap={4} wrap="nowrap">
                    {qr && <QrButton value={value} title={label} />}
                    <Copy value={value} />
                </Group>
            </Group>
        </Paper>
    );
}

export function StatCard({ title, value, hint, icon, color = 'cyan' }: { title: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; color?: string }) {
    return (
        <Paper withBorder p="md" radius="md" className="glass">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
                <div>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                        {title}
                    </Text>
                    <Text size="xl" fw={700} mt={4}>
                        {value}
                    </Text>
                    {hint && (
                        <Text size="xs" c="dimmed" mt={2}>
                            {hint}
                        </Text>
                    )}
                </div>
                <ThemeIcon size={42} radius="md" variant="light" color={color}>
                    {icon}
                </ThemeIcon>
            </Group>
        </Paper>
    );
}

export function TrafficCell({ user }: { user: Pick<User, 'trafficUsed' | 'trafficLimit'> }) {
    const pct = user.trafficLimit > 0 ? Math.min(100, (user.trafficUsed / user.trafficLimit) * 100) : 0;
    return (
        <Stack gap={4} miw={140}>
            <Text size="xs">
                {bytes(user.trafficUsed)} / {user.trafficLimit > 0 ? bytes(user.trafficLimit) : '∞'}
            </Text>
            <Progress value={user.trafficLimit > 0 ? pct : 0} size="sm" color={pct > 90 ? 'red' : pct > 70 ? 'orange' : 'cyan'} />
        </Stack>
    );
}
