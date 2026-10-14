import { Group, Text, ThemeIcon } from '@mantine/core';
import { IconShieldCheck } from '@tabler/icons-react';

export function Logo({ size = 'lg' }: { size?: 'lg' | 'xl' }) {
    return (
        <Group gap={8} wrap="nowrap">
            <ThemeIcon size={size === 'xl' ? 40 : 32} radius="md" variant="gradient" gradient={{ from: 'cyan.7', to: 'teal.6' }}>
                <IconShieldCheck size={size === 'xl' ? 24 : 20} />
            </ThemeIcon>
            <Text fw={700} size={size} style={{ letterSpacing: 1 }}>
                BRPAN
            </Text>
        </Group>
    );
}
