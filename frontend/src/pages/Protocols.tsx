import { ActionIcon, Alert, Badge, Button, Group, NumberInput, Paper, PasswordInput, Select, SimpleGrid, Stack, Switch, TagsInput, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconInfoCircle, IconRefresh, IconStar, IconStarFilled } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';

import { Copy } from '@/components/common';
import { countryFlag } from '@/lib/countries';
import { api, notifyOk } from '@/lib/api';
import { PROTOCOL_META, type Protocol, type Settings } from '@/lib/types';

type P = Settings['protocols'];

function ProtocolCard<K extends keyof P>({
    id,
    settings,
    ports,
    children,
    extra,
}: {
    id: K;
    settings: Settings;
    ports: string;
    children: (form: ReturnType<typeof useForm<P[K]>>) => ReactNode;
    extra?: ReactNode;
}) {
    const qc = useQueryClient();
    const [saving, setSaving] = useState(false);
    const form = useForm<P[K]>({ initialValues: settings.protocols[id] });
    useEffect(() => {
        form.setValues(settings.protocols[id]);
        form.resetDirty();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings]);
    const meta = PROTOCOL_META[id as Protocol];
    const isMain = settings.mainProtocol === id;

    const setMain = async () => {
        await api('/api/settings', { method: 'PATCH', body: { mainProtocol: isMain ? null : (id as Protocol) } });
        notifyOk(isMain ? 'Main protocol cleared' : `${meta.label} set as main`);
        await qc.invalidateQueries({ queryKey: ['settings'] });
    };

    const save = form.onSubmit(async (values) => {
        setSaving(true);
        try {
            const { privateKey: _pk, publicKey: _pub, internalPort: _ip, ...rest } = values as Record<string, unknown>;
            const body = id === 'vless-reality' ? { ...rest, privateKey: _pk } : rest;
            await api('/api/settings', { method: 'PATCH', body: { protocols: { [id]: body } } });
            notifyOk(`${meta.label} saved, cores are reloading`);
            await qc.invalidateQueries({ queryKey: ['settings'] });
        } finally {
            setSaving(false);
        }
    });

    return (
        <Paper withBorder p="md" className="glass">
            <form onSubmit={save}>
                <Stack gap="sm">
                    <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs">
                            <Badge color={meta.color} variant="light" size="lg">
                                {countryFlag(settings.country)} {meta.label}
                            </Badge>
                            <Text size="xs" c="dimmed">
                                {ports}
                            </Text>
                        </Group>
                        <Group gap="xs">
                            <Tooltip label={isMain ? 'Main protocol (shown first in subscriptions)' : 'Set as main'}>
                                <ActionIcon variant={isMain ? 'filled' : 'subtle'} color="yellow" onClick={setMain}>
                                    {isMain ? <IconStarFilled size={16} /> : <IconStar size={16} />}
                                </ActionIcon>
                            </Tooltip>
                            <Switch {...form.getInputProps('enabled' as never, { type: 'checkbox' })} />
                        </Group>
                    </Group>
                    <Text size="xs" c="dimmed">
                        Clients: {meta.clients}
                    </Text>
                    {children(form)}
                    <Group justify="space-between">
                        <div>{extra}</div>
                        <Button type="submit" size="xs" loading={saving} disabled={!form.isDirty()}>
                            Save
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Paper>
    );
}

function KeyField({ label, value }: { label: string; value: string }) {
    return (
        <TextInput
            label={label}
            value={value}
            readOnly
            classNames={{ input: 'mono' }}
            rightSection={<Copy value={value} size="sm" />}
        />
    );
}

export function ProtocolsPage() {
    const qc = useQueryClient();
    const { data: s } = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/api/settings') });
    if (!s) return null;

    const regenerate = (what: 'reality' | 'wireguard' | 'amneziawg' | 'paths', text: string) =>
        modals.openConfirmModal({
            title: 'Regenerate',
            children: <Text size="sm">{text}</Text>,
            labels: { confirm: 'Regenerate', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: async () => {
                await api(`/api/settings/regenerate/${what}`, { method: 'POST' });
                notifyOk('Regenerated');
                await qc.invalidateQueries({ queryKey: ['settings'] });
            },
        });

    const noDomain = !s.domain;

    return (
        <Stack>
            <Title order={3}>Protocols</Title>
            <Alert variant="light" icon={<IconInfoCircle />}>
                Every protocol runs on this server at the same time. Users get one subscription URL with all protocols allowed for them; per-user protocol selection is
                in the user form. Changing a port requires opening it in the firewall.
            </Alert>
            {noDomain && (
                <Alert color="orange" variant="light">
                    No domain configured: VLESS XHTTP and Trojan WS need a domain with TLS, Hysteria2 uses a self-signed certificate with pinning.
                </Alert>
            )}
            <SimpleGrid cols={{ base: 1, lg: 2 }}>
                <ProtocolCard
                    id="vless-reality"
                    settings={s}
                    ports={`${s.protocols['vless-reality'].port}/tcp`}
                    extra={
                        <Button size="xs" variant="subtle" color="red" leftSection={<IconRefresh size={14} />} onClick={() => regenerate('reality', 'New Reality keys: every client must update the subscription.')}>
                            New keys
                        </Button>
                    }
                >
                    {(form) => (
                        <>
                            <SimpleGrid cols={2}>
                                <NumberInput label="Port" min={1} max={65535} {...form.getInputProps('port')} />
                                <Select label="Fingerprint" data={['chrome', 'firefox', 'safari', 'ios', 'edge', 'random']} {...form.getInputProps('fingerprint')} />
                            </SimpleGrid>
                            <TextInput
                                label="Target (dest)"
                                description={s.domain ? `127.0.0.1:8443 = steal from own Caddy with ${s.domain} (panel works on 443)` : 'Foreign TLS 1.3 site, e.g. www.google.com:443'}
                                {...form.getInputProps('target')}
                            />
                            <TagsInput label="Server names (SNI)" {...form.getInputProps('serverNames')} />
                            <TagsInput label="Short IDs" description="hex, up to 16 chars" {...form.getInputProps('shortIds')} />
                            <KeyField label="Public key" value={form.values.publicKey} />
                        </>
                    )}
                </ProtocolCard>

                <ProtocolCard id="vless-xhttp" settings={s} ports={`via Caddy, ${new URL(s.publicBaseUrl).port || 443}/tcp`}>
                    {(form) => (
                        <>
                            <SimpleGrid cols={2}>
                                <TextInput label="Path" {...form.getInputProps('path')} />
                                <Select label="Mode" data={['auto', 'packet-up', 'stream-up', 'stream-one']} {...form.getInputProps('mode')} />
                            </SimpleGrid>
                            <Text size="xs" c="dimmed">
                                TLS terminated by Caddy, CDN friendly (Cloudflare gRPC/WebSocket off is fine).
                            </Text>
                        </>
                    )}
                </ProtocolCard>

                <ProtocolCard
                    id="trojan-ws"
                    settings={s}
                    ports={`via Caddy, ${new URL(s.publicBaseUrl).port || 443}/tcp`}
                    extra={
                        <Button size="xs" variant="subtle" color="gray" leftSection={<IconRefresh size={14} />} onClick={() => regenerate('paths', 'Generate new random paths for XHTTP and Trojan WS?')}>
                            New paths
                        </Button>
                    }
                >
                    {(form) => <TextInput label="WebSocket path" {...form.getInputProps('path')} />}
                </ProtocolCard>

                <ProtocolCard id="shadowsocks" settings={s} ports={`${s.protocols.shadowsocks.port}/tcp+udp`}>
                    {(form) => (
                        <>
                            <SimpleGrid cols={2}>
                                <NumberInput label="Port" min={1} max={65535} {...form.getInputProps('port')} />
                                <Select label="Cipher" data={['chacha20-ietf-poly1305', 'aes-256-gcm', 'aes-128-gcm']} {...form.getInputProps('method')} />
                            </SimpleGrid>
                            <TextInput
                                label="Outline prefix"
                                description='Optional disguise prefix for Outline clients, e.g. "%16%03%01%00%C2%A8%01%01" (TLS ClientHello)'
                                {...form.getInputProps('prefix')}
                            />
                        </>
                    )}
                </ProtocolCard>

                <ProtocolCard id="hysteria2" settings={s} ports={`${s.protocols.hysteria2.port}/udp`}>
                    {(form) => (
                        <>
                            <NumberInput label="Port" min={1} max={65535} {...form.getInputProps('port')} />
                            <PasswordInput label="Salamander obfuscation password" description="Empty = no obfuscation (looks like HTTP/3)" {...form.getInputProps('obfsPassword')} />
                        </>
                    )}
                </ProtocolCard>

                <ProtocolCard
                    id="wireguard"
                    settings={s}
                    ports={`${s.protocols.wireguard.port}/udp`}
                    extra={
                        <Button size="xs" variant="subtle" color="red" leftSection={<IconRefresh size={14} />} onClick={() => regenerate('wireguard', 'New server key: every WireGuard config must be re-imported.')}>
                            New key
                        </Button>
                    }
                >
                    {(form) => (
                        <>
                            <SimpleGrid cols={3}>
                                <NumberInput label="Port" min={1} max={65535} {...form.getInputProps('port')} />
                                <TextInput label="Subnet" {...form.getInputProps('subnet')} />
                                <NumberInput label="MTU" min={1280} max={1500} {...form.getInputProps('mtu')} />
                            </SimpleGrid>
                            <TextInput label="DNS" {...form.getInputProps('dns')} />
                            <KeyField label="Server public key" value={form.values.publicKey} />
                        </>
                    )}
                </ProtocolCard>

                <ProtocolCard
                    id="amneziawg"
                    settings={s}
                    ports={`${s.protocols.amneziawg.port}/udp`}
                    extra={
                        <Button size="xs" variant="subtle" color="red" leftSection={<IconRefresh size={14} />} onClick={() => regenerate('amneziawg', 'New server key: every AmneziaWG config must be re-imported.')}>
                            New key
                        </Button>
                    }
                >
                    {(form) => (
                        <>
                            <SimpleGrid cols={3}>
                                <NumberInput label="Port" min={1} max={65535} {...form.getInputProps('port')} />
                                <TextInput label="Subnet" {...form.getInputProps('subnet')} />
                                <NumberInput label="MTU" min={1200} max={1500} {...form.getInputProps('mtu')} />
                            </SimpleGrid>
                            <TextInput label="DNS" {...form.getInputProps('dns')} />
                            <SimpleGrid cols={5}>
                                <NumberInput label="Jc" {...form.getInputProps('jc')} />
                                <NumberInput label="Jmin" {...form.getInputProps('jmin')} />
                                <NumberInput label="Jmax" {...form.getInputProps('jmax')} />
                                <NumberInput label="S1" {...form.getInputProps('s1')} />
                                <NumberInput label="S2" {...form.getInputProps('s2')} />
                            </SimpleGrid>
                            <SimpleGrid cols={4}>
                                <NumberInput label="H1" hideControls {...form.getInputProps('h1')} />
                                <NumberInput label="H2" hideControls {...form.getInputProps('h2')} />
                                <NumberInput label="H3" hideControls {...form.getInputProps('h3')} />
                                <NumberInput label="H4" hideControls {...form.getInputProps('h4')} />
                            </SimpleGrid>
                            <KeyField label="Server public key" value={form.values.publicKey} />
                        </>
                    )}
                </ProtocolCard>

                <ProtocolCard id="openvpn" settings={s} ports={`${s.protocols.openvpn.port}/${s.protocols.openvpn.proto}`}>
                    {(form) => (
                        <>
                            <SimpleGrid cols={3}>
                                <NumberInput label="Port" min={1} max={65535} {...form.getInputProps('port')} />
                                <Select label="Transport" data={['udp', 'tcp']} {...form.getInputProps('proto')} />
                                <TextInput label="Subnet" {...form.getInputProps('subnet')} />
                            </SimpleGrid>
                            <TextInput label="DNS" description="Comma separated" {...form.getInputProps('dns')} />
                            <Text size="xs" c="dimmed">
                                Per-user certificates, profiles are issued on first download. Disabled by default: OpenVPN is easy to detect by DPI.
                            </Text>
                        </>
                    )}
                </ProtocolCard>
            </SimpleGrid>
        </Stack>
    );
}
