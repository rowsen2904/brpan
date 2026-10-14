import { Accordion, Alert, Anchor, Badge, Box, Button, Center, Container, Group, Loader, Paper, Progress, SegmentedControl, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useClipboard, useOs } from '@mantine/hooks';
import { IconCopy, IconDownload, IconExternalLink, IconPlus, IconSpeakerphone } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { LinkRow } from '@/components/common';
import { Logo } from '@/components/Logo';
import { countryFlag } from '@/lib/countries';
import { bytes, date, daysLeft } from '@/lib/format';
import type { SubscriptionInfo } from '@/lib/types';

interface PublicInfo extends SubscriptionInfo {
    username: string;
    status: string;
    active: boolean;
    message: string | null;
    trafficUsed: number;
    trafficLimit: number;
    expireAt: number | null;
    deviceLimit: number;
    profileTitle: string;
    country: string;
    supportUrl: string;
    announce: string;
}

type Platform = 'ios' | 'android' | 'windows' | 'macos' | 'linux';

interface App {
    name: string;
    note: string;
    platforms: Platform[];
    store: Partial<Record<Platform, string>>;
    add?: (info: PublicInfo) => string | null;
    download?: (info: PublicInfo) => { label: string; href: string } | null;
    copy?: (info: PublicInfo) => string | null;
}

const APPS: App[] = [
    {
        name: 'Happ',
        note: 'Recommended. All protocols, device limit aware.',
        platforms: ['ios', 'android', 'windows', 'macos'],
        store: {
            ios: 'https://apps.apple.com/us/app/happ-proxy-utility/id6504287215',
            android: 'https://play.google.com/store/apps/details?id=com.happproxy',
            windows: 'https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe',
            macos: 'https://apps.apple.com/us/app/happ-proxy-utility/id6504287215',
        },
        add: (i) => i.happ ?? i.happPlain,
    },
    {
        name: 'v2RayTun',
        note: 'Simple Xray client.',
        platforms: ['ios', 'android', 'windows'],
        store: { ios: 'https://v2raytun.com/', android: 'https://v2raytun.com/', windows: 'https://v2raytun.com/' },
        add: (i) => `v2raytun://import/${i.url}`,
    },
    {
        name: 'Hiddify',
        note: 'Open source, sing-box based.',
        platforms: ['ios', 'android', 'windows', 'macos', 'linux'],
        store: { ios: 'https://hiddify.com/', android: 'https://hiddify.com/', windows: 'https://hiddify.com/', macos: 'https://hiddify.com/', linux: 'https://hiddify.com/' },
        add: (i) => `hiddify://import/${i.url}#${encodeURIComponent(i.profileTitle)}`,
    },
    {
        name: 'Streisand',
        note: 'iOS Xray client.',
        platforms: ['ios', 'macos'],
        store: { ios: 'https://apps.apple.com/ru/app/streisand/id6450534064', macos: 'https://apps.apple.com/ru/app/streisand/id6450534064' },
        add: (i) => `streisand://import/${i.url}`,
    },
    {
        name: 'Shadowrocket',
        note: 'Paid iOS client.',
        platforms: ['ios'],
        store: { ios: 'https://apps.apple.com/ru/app/shadowrocket/id932747118' },
        add: (i) => `shadowrocket://add/${i.url}#${encodeURIComponent(i.profileTitle)}`,
    },
    {
        name: 'v2rayNG',
        note: 'Classic Android client.',
        platforms: ['android'],
        store: { android: 'https://github.com/2dust/v2rayNG/releases/latest' },
        add: (i) => `v2rayng://install-config?name=${encodeURIComponent(i.profileTitle)}&url=${encodeURIComponent(i.url)}`,
    },
    {
        name: 'FlClashX',
        note: 'Clash Meta (mihomo) GUI.',
        platforms: ['android', 'windows', 'macos', 'linux'],
        store: {
            android: 'https://github.com/pluralplay/FlClashX/releases/latest',
            windows: 'https://github.com/pluralplay/FlClashX/releases/latest',
            macos: 'https://github.com/pluralplay/FlClashX/releases/latest',
            linux: 'https://github.com/pluralplay/FlClashX/releases/latest',
        },
        add: (i) => `flclashx://install-config?url=${encodeURIComponent(i.clash)}`,
    },
    {
        name: 'Outline',
        note: 'Shadowsocks only. Paste the key in the app.',
        platforms: ['ios', 'android', 'windows', 'macos', 'linux'],
        store: {
            ios: 'https://getoutline.org/get-started/#step-3',
            android: 'https://getoutline.org/get-started/#step-3',
            windows: 'https://getoutline.org/get-started/#step-3',
            macos: 'https://getoutline.org/get-started/#step-3',
            linux: 'https://getoutline.org/get-started/#step-3',
        },
        copy: (i) => i.outline,
    },
    {
        name: 'AmneziaVPN',
        note: 'AmneziaWG config, works where WireGuard is blocked.',
        platforms: ['ios', 'android', 'windows', 'macos', 'linux'],
        store: {
            ios: 'https://amnezia.org/downloads',
            android: 'https://amnezia.org/downloads',
            windows: 'https://amnezia.org/downloads',
            macos: 'https://amnezia.org/downloads',
            linux: 'https://amnezia.org/downloads',
        },
        download: (i) => (i.amneziawg ? { label: 'AmneziaWG .conf', href: i.amneziawg } : null),
    },
    {
        name: 'WireGuard',
        note: 'Official WireGuard app.',
        platforms: ['ios', 'android', 'windows', 'macos', 'linux'],
        store: {
            ios: 'https://www.wireguard.com/install/',
            android: 'https://www.wireguard.com/install/',
            windows: 'https://www.wireguard.com/install/',
            macos: 'https://www.wireguard.com/install/',
            linux: 'https://www.wireguard.com/install/',
        },
        download: (i) => (i.wireguard ? { label: 'WireGuard .conf', href: i.wireguard } : null),
    },
    {
        name: 'OpenVPN Connect',
        note: 'Import the .ovpn profile.',
        platforms: ['ios', 'android', 'windows', 'macos', 'linux'],
        store: {
            ios: 'https://openvpn.net/client/',
            android: 'https://openvpn.net/client/',
            windows: 'https://openvpn.net/client/',
            macos: 'https://openvpn.net/client/',
            linux: 'https://openvpn.net/client/',
        },
        download: (i) => (i.openvpn ? { label: 'OpenVPN .ovpn', href: i.openvpn } : null),
    },
];

const PLATFORMS: { value: Platform; label: string }[] = [
    { value: 'ios', label: 'iOS' },
    { value: 'android', label: 'Android' },
    { value: 'windows', label: 'Windows' },
    { value: 'macos', label: 'macOS' },
    { value: 'linux', label: 'Linux' },
];

function osToPlatform(os: string): Platform {
    if (os === 'ios' || os === 'android' || os === 'windows' || os === 'macos' || os === 'linux') return os;
    return 'android';
}

function available(app: App, info: PublicInfo) {
    if (app.copy) return !!app.copy(info);
    if (app.download) return !!app.download(info);
    return true;
}

export function SubscriptionPage() {
    const { token } = useParams();
    const os = useOs();
    const clipboard = useClipboard({ timeout: 1500 });
    const [platform, setPlatform] = useState<Platform>('android');
    useEffect(() => setPlatform(osToPlatform(os)), [os]);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['public-sub', token],
        queryFn: async () => {
            const res = await fetch(`/sub/${token}/info`);
            if (!res.ok) throw new Error('not found');
            return (await res.json()) as PublicInfo;
        },
    });

    if (isLoading)
        return (
            <Center mih="100vh">
                <Loader />
            </Center>
        );
    if (isError || !data)
        return (
            <Center mih="100vh">
                <Text c="dimmed">Subscription not found</Text>
            </Center>
        );

    const left = daysLeft(data.expireAt);
    const pct = data.trafficLimit > 0 ? Math.min(100, (data.trafficUsed / data.trafficLimit) * 100) : 0;
    const apps = APPS.filter((a) => a.platforms.includes(platform) && available(a, data));
    const qrValue = data.happ ?? data.url;

    return (
        <Container size="sm" py="xl" px="md">
            <Stack>
                <Group justify="space-between">
                    <Logo />
                    {data.supportUrl && (
                        <Button component="a" href={data.supportUrl} target="_blank" variant="light" size="xs">
                            Support
                        </Button>
                    )}
                </Group>

                <Paper withBorder p="lg" className="glass">
                    <Group justify="space-between" align="flex-start">
                        <div>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                                {countryFlag(data.country)} {data.profileTitle}
                            </Text>
                            <Title order={3}>{data.username}</Title>
                        </div>
                        <Badge size="lg" color={data.active ? 'teal' : 'red'} variant="light">
                            {data.active ? 'Active' : data.status}
                        </Badge>
                    </Group>
                    {data.message && (
                        <Alert color="red" variant="light" mt="md">
                            {data.message}
                        </Alert>
                    )}
                    <SimpleGrid cols={{ base: 1, xs: 3 }} mt="md">
                        <div>
                            <Text size="xs" c="dimmed">
                                Traffic
                            </Text>
                            <Text fw={600}>
                                {bytes(data.trafficUsed)} / {data.trafficLimit > 0 ? bytes(data.trafficLimit) : '∞'}
                            </Text>
                            {data.trafficLimit > 0 && <Progress value={pct} mt={6} color={pct > 90 ? 'red' : 'cyan'} />}
                        </div>
                        <div>
                            <Text size="xs" c="dimmed">
                                Expires
                            </Text>
                            <Text fw={600}>{data.expireAt ? date(data.expireAt, false) : 'Never'}</Text>
                            {left !== null && (
                                <Text size="xs" c={left < 3 ? 'red' : 'dimmed'}>
                                    {left > 0 ? `${left} days left` : 'expired'}
                                </Text>
                            )}
                        </div>
                        <div>
                            <Text size="xs" c="dimmed">
                                Devices
                            </Text>
                            <Text fw={600}>{data.deviceLimit || 'Unlimited'}</Text>
                        </div>
                    </SimpleGrid>
                </Paper>

                {data.announce && (
                    <Alert icon={<IconSpeakerphone />} variant="light">
                        {data.announce}
                    </Alert>
                )}

                {data.active && (
                    <>
                        <Paper withBorder p="lg" className="glass">
                            <Group align="flex-start" wrap="wrap" gap="lg">
                                <Box p="sm" bg="white" style={{ borderRadius: 12 }}>
                                    <QRCodeSVG value={qrValue} size={150} />
                                </Box>
                                <Stack gap="xs" style={{ flex: 1, minWidth: 220 }}>
                                    <Text fw={600}>Quick setup</Text>
                                    <Text size="sm" c="dimmed">
                                        Install an app below, then tap “Add”. Or scan the QR code in Happ.
                                    </Text>
                                    <Button component="a" href={data.happ ?? data.happPlain} leftSection={<IconPlus size={16} />}>
                                        Add to Happ
                                    </Button>
                                    <Button variant="light" leftSection={<IconCopy size={16} />} onClick={() => clipboard.copy(data.url)}>
                                        {clipboard.copied ? 'Copied' : 'Copy subscription link'}
                                    </Button>
                                </Stack>
                            </Group>
                        </Paper>

                        <SegmentedControl fullWidth value={platform} onChange={(v) => setPlatform(v as Platform)} data={PLATFORMS} />

                        <Stack gap="xs">
                            {apps.map((app) => {
                                const add = app.add?.(data);
                                const dl = app.download?.(data);
                                const copy = app.copy?.(data);
                                return (
                                    <Paper key={app.name} withBorder p="md" className="glass">
                                        <Group justify="space-between" wrap="wrap" gap="sm">
                                            <div>
                                                <Text fw={600}>{app.name}</Text>
                                                <Text size="xs" c="dimmed">
                                                    {app.note}
                                                </Text>
                                            </div>
                                            <Group gap="xs">
                                                {app.store[platform] && (
                                                    <Button component="a" href={app.store[platform]} target="_blank" size="xs" variant="default" leftSection={<IconExternalLink size={14} />}>
                                                        Install
                                                    </Button>
                                                )}
                                                {add && (
                                                    <Button component="a" href={add} size="xs" leftSection={<IconPlus size={14} />}>
                                                        Add
                                                    </Button>
                                                )}
                                                {dl && (
                                                    <Button component="a" href={dl.href} size="xs" leftSection={<IconDownload size={14} />}>
                                                        {dl.label}
                                                    </Button>
                                                )}
                                                {copy && (
                                                    <Button size="xs" leftSection={<IconCopy size={14} />} onClick={() => clipboard.copy(copy)}>
                                                        Copy key
                                                    </Button>
                                                )}
                                            </Group>
                                        </Group>
                                    </Paper>
                                );
                            })}
                        </Stack>

                        <Accordion variant="separated">
                            <Accordion.Item value="keys">
                                <Accordion.Control>Manual keys</Accordion.Control>
                                <Accordion.Panel>
                                    <Stack gap="xs">
                                        {data.outline && <LinkRow label="Outline key" value={data.outline} />}
                                        {data.links.map((l) => (l.link ? <LinkRow key={l.protocol} label={l.label} value={l.link} /> : null))}
                                        <LinkRow label="Clash / Mihomo" value={data.clash} qr={false} />
                                        <LinkRow label="sing-box" value={data.singbox} qr={false} />
                                    </Stack>
                                </Accordion.Panel>
                            </Accordion.Item>
                        </Accordion>
                    </>
                )}

                <Text size="xs" c="dimmed" ta="center">
                    Powered by BRPAN · <Anchor size="xs" href={data.url}>{data.url.replace(/^https?:\/\//, '').split('/')[0]}</Anchor>
                </Text>
            </Stack>
        </Container>
    );
}
