// OrganizerScreen — composition shell. Data in hooks/useOrganizerShows
// (owned shows + roster loads), form flows in useShowForm/useVendorAdd/
// useRegActions, and all rendering in components/organizer/* sharing
// organizerStyles. Text/SMS helpers live in services/organizerText.
import { useOrganizerShows } from '../hooks/useOrganizerShows';
import { useShowForm } from '../hooks/useShowForm';
import { useVendorAdd } from '../hooks/useVendorAdd';
import { useRegActions } from '../hooks/useRegActions';
import { ShowListMode } from '../components/organizer/ShowListMode';
import { ShowDetailMode } from '../components/organizer/ShowDetailMode';
import { ShowFormModal } from '../components/organizer/ShowFormModal';
import { AddVendorModal } from '../components/organizer/AddVendorModal';
import {
  ApproveModal,
  AssignModal,
  PayModal,
  RemindModal,
} from '../components/organizer/RegActionModals';

export function OrganizerScreen({ onBack }: { onBack: () => void }) {
  const data = useOrganizerShows();
  const {
    selected,
    registrations,
    loading,
    error,
    setSelected,
    setError,
    loadShows,
    loadRegs,
    openDetail,
    refreshSelected,
  } = data;

  const showForm = useShowForm({
    selected,
    setSelected,
    setError,
    loadShows,
    loadRegs,
  });
  const vendorAdd = useVendorAdd({ selected, setError, refreshSelected });
  const regActions = useRegActions({
    selected,
    setSelected,
    setError,
    loadShows,
    refreshSelected,
  });

  // ----- list mode -----
  if (!selected) {
    return (
      <>
        <ShowListMode
          shows={data.shows}
          loading={loading}
          error={error}
          onBack={onBack}
          onNewShow={showForm.openNewShow}
          onOpenShow={openDetail}
        />
        {showForm.showFormOpen ? (
          <ShowFormModal
            editingShow={showForm.editingShow}
            fName={showForm.fName}
            setFName={showForm.setFName}
            fDate={showForm.fDate}
            setFDate={showForm.setFDate}
            fLocation={showForm.fLocation}
            setFLocation={showForm.setFLocation}
            fTables={showForm.fTables}
            setFTables={showForm.setFTables}
            fPay={showForm.fPay}
            setFPay={showForm.setFPay}
            saving={showForm.saving}
            onSave={showForm.saveShow}
            onClose={() => showForm.setShowFormOpen(false)}
          />
        ) : null}
      </>
    );
  }

  // ----- detail mode -----
  return (
    <>
      <ShowDetailMode
        selected={selected}
        registrations={registrations}
        error={error}
        onBackToList={() => setSelected(null)}
        onEditShow={showForm.openEditShow}
        onUnpublish={regActions.confirmUnpublish}
        onAddVendor={vendorAdd.openAddVendor}
        onApprove={regActions.openApprove}
        onReject={regActions.commitReject}
        onPay={regActions.openPay}
        onAssign={regActions.openAssign}
        onRemind={regActions.handleRemind}
      />

      {showForm.showFormOpen && showForm.editingShow ? (
        <ShowFormModal
          editingShow={showForm.editingShow}
          fName={showForm.fName}
          setFName={showForm.setFName}
          fDate={showForm.fDate}
          setFDate={showForm.setFDate}
          fLocation={showForm.fLocation}
          setFLocation={showForm.setFLocation}
          fTables={showForm.fTables}
          setFTables={showForm.setFTables}
          fPay={showForm.fPay}
          setFPay={showForm.setFPay}
          saving={showForm.saving}
          onSave={showForm.saveShow}
          onClose={() => showForm.setShowFormOpen(false)}
        />
      ) : null}

      {vendorAdd.addOpen ? (
        <AddVendorModal
          appVendors={vendorAdd.appVendors}
          pickedVendor={vendorAdd.pickedVendor}
          setPickedVendor={vendorAdd.setPickedVendor}
          manualMode={vendorAdd.manualMode}
          setManualMode={vendorAdd.setManualMode}
          mName={vendorAdd.mName}
          setMName={vendorAdd.setMName}
          mPhone={vendorAdd.mPhone}
          setMPhone={vendorAdd.setMPhone}
          mTable={vendorAdd.mTable}
          setMTable={vendorAdd.setMTable}
          mDue={vendorAdd.mDue}
          setMDue={vendorAdd.setMDue}
          onAttachVendor={vendorAdd.attachVendor}
          onAttachManual={vendorAdd.attachManual}
          onClose={() => vendorAdd.setAddOpen(false)}
        />
      ) : null}

      {regActions.approveTarget ? (
        <ApproveModal
          reg={regActions.approveTarget}
          aTable={regActions.aTable}
          setATable={regActions.setATable}
          aDue={regActions.aDue}
          setADue={regActions.setADue}
          aPhone={regActions.aPhone}
          setAPhone={regActions.setAPhone}
          onApprove={regActions.commitApprove}
          onClose={() => regActions.setApproveTarget(null)}
        />
      ) : null}

      {regActions.payTarget ? (
        <PayModal
          reg={regActions.payTarget}
          payAmount={regActions.payAmount}
          setPayAmount={regActions.setPayAmount}
          payDue={regActions.payDue}
          setPayDue={regActions.setPayDue}
          onPay={regActions.commitPay}
          onClose={() => regActions.setPayTarget(null)}
        />
      ) : null}

      {regActions.assignTarget ? (
        <AssignModal
          reg={regActions.assignTarget}
          assignTable={regActions.assignTable}
          setAssignTable={regActions.setAssignTable}
          onSave={regActions.commitAssign}
          onClose={() => regActions.setAssignTarget(null)}
        />
      ) : null}

      {regActions.remindTarget ? (
        <RemindModal
          reg={regActions.remindTarget}
          remindPhone={regActions.remindPhone}
          setRemindPhone={regActions.setRemindPhone}
          onRemind={regActions.commitRemind}
          onClose={() => regActions.setRemindTarget(null)}
        />
      ) : null}
    </>
  );
}
