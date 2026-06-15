/**
 * 响应式弹窗组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：PC 端渲染 Modal，移动端渲染底部 Drawer。
 * 2. 不做什么：不处理内部业务逻辑，只做容器适配。
 *
 * 输入 / 输出：
 * - open/onClose/title/children: 透传给 Modal 或 Drawer
 * - onOk: 确认回调（Drawer 模式下渲染确认按钮）
 * - okText/okButtonProps: 确认按钮文案和属性
 *
 * 复用设计说明：
 * - 避免在每个业务组件中重复 isMobile ? Modal : Drawer 判断。
 * - 被灵田系统的播种、购买、出售等弹窗复用。
 *
 * 关键边界条件与坑点：
 * 1. React 19 与 antd 内部的 React types 版本不一致，children 需要用 any 绕过类型检查。
 */

import { Modal, Drawer, Button } from 'antd';
import { useIsMobile } from './responsive';

interface ResponsiveModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: unknown;
  /** 移动端抽屉高度（默认 70vh） */
  mobileHeight?: string;
  /** 确认回调（Modal 的 onOk，Drawer 渲染确认按钮） */
  onOk?: () => void;
  /** 确认按钮文案（默认"确定"） */
  okText?: string;
  /** 确认按钮属性 */
  okButtonProps?: { disabled?: boolean; loading?: boolean };
}

const ResponsiveModal = (props: ResponsiveModalProps) => {
  const { open, onClose, title, children, mobileHeight = '70vh', onOk, okText = '确定', okButtonProps } = props;
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        title={title}
        placement="bottom"
        height={mobileHeight}
        styles={{ body: { padding: '16px' } }}
        extra={
          onOk ? (
            <Button type="primary" onClick={onOk} {...okButtonProps}>
              {okText}
            </Button>
          ) : null
        }
      >
        {children as never}
      </Drawer>
    );
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={title}
      onOk={onOk}
      okText={okText}
      okButtonProps={okButtonProps}
    >
      {children as never}
    </Modal>
  );
};

export default ResponsiveModal;
